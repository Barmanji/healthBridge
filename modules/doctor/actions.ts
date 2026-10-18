"use server";

import { and, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  auditLogs,
  appointments,
  doctorAvailabilityRules,
  doctorDocuments,
  doctorProfiles,
  doctorSoapNotes,
  doctorTimeOff,
} from "@/lib/db/schema";
import {
  availabilityStepSchema,
  personalStepSchema,
  practiceStepSchema,
  professionalStepSchema,
  reviewDecisionSchema,
  submitApplicationSchema,
} from "@/modules/doctor/schemas";

async function requireDoctor() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "doctor") {
    throw new Error("Sign in with a doctor account to continue.");
  }
  return session.user;
}

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") {
    throw new Error("Admin access is required.");
  }
  return session.user;
}

async function ensureProfile(userId: string) {
  await db.insert(doctorProfiles).values({ userId }).onConflictDoNothing({ target: doctorProfiles.userId });
  const [profile] = await db.select().from(doctorProfiles).where(eq(doctorProfiles.userId, userId)).limit(1);
  if (!profile) throw new Error("Could not load the doctor application.");
  return profile;
}

async function assertEditable(profileId: string) {
  const [profile] = await db.select().from(doctorProfiles).where(eq(doctorProfiles.id, profileId)).limit(1);
  if (!profile || !["draft", "needs_info"].includes(profile.verificationStatus)) {
    throw new Error("This application can no longer be edited.");
  }
  return profile;
}

export async function saveDoctorStep(step: 2 | 3 | 4 | 5, input: unknown) {
  const doctor = await requireDoctor();
  const profile = await ensureProfile(doctor.id);
  await assertEditable(profile.id);

  if (step === 2) {
    const parsed = personalStepSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Check the personal details." };
    const value = parsed.data;
    await db.update(doctorProfiles).set({
      fullName: value.fullName,
      phone: value.phone,
      gender: value.gender || null,
      dateOfBirth: value.dateOfBirth ? new Date(`${value.dateOfBirth}T00:00:00.000Z`) : null,
      city: value.city,
      state: value.state,
      bio: value.bio || null,
      onboardingStep: Math.max(profile.onboardingStep, 3),
    }).where(eq(doctorProfiles.id, profile.id));
  } else if (step === 3) {
    const parsed = professionalStepSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Check the professional details." };
    const value = parsed.data;
    await db.update(doctorProfiles).set({
      registrationNumber: value.registrationNumber,
      registrationCouncil: value.registrationCouncil,
      registrationYear: value.registrationYear,
      departmentId: value.departmentId,
      subSpecialties: value.subSpecialties,
      qualifications: value.qualifications,
      yearsExperience: value.yearsExperience,
      onboardingStep: Math.max(profile.onboardingStep, 4),
    }).where(eq(doctorProfiles.id, profile.id));
  } else if (step === 4) {
    const parsed = practiceStepSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Check the practice details." };
    const value = parsed.data;
    await db.update(doctorProfiles).set({
      clinicName: value.clinicName || null,
      clinicAddress: value.clinicAddress || null,
      languages: [...new Set(value.languages)],
      consultModes: [...new Set(value.consultModes)],
      feeInr: value.feeInr ?? null,
      onboardingStep: Math.max(profile.onboardingStep, 5),
    }).where(eq(doctorProfiles.id, profile.id));
  } else {
    const parsed = availabilityStepSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Check the availability schedule." };
    await replaceAvailability(profile.id, parsed.data);
    await db.update(doctorProfiles).set({
      timeZone: parsed.data.timeZone,
      slotMinutes: parsed.data.slotMinutes,
      bufferMinutes: parsed.data.bufferMinutes,
      onboardingStep: Math.max(profile.onboardingStep, 6),
    }).where(eq(doctorProfiles.id, profile.id));
  }

  revalidatePath("/doctor/onboarding");
  return { ok: true as const };
}

async function replaceAvailability(
  doctorId: string,
  value: ReturnType<typeof availabilityStepSchema.parse>,
) {
  await db.transaction(async (tx) => {
    await tx.delete(doctorAvailabilityRules).where(eq(doctorAvailabilityRules.doctorId, doctorId));
    await tx.delete(doctorTimeOff).where(eq(doctorTimeOff.doctorId, doctorId));
    if (value.weeklySchedule.length) {
      await tx.insert(doctorAvailabilityRules).values(value.weeklySchedule.map((rule) => ({ doctorId, ...rule })));
    }
    if (value.plannedLeave.length) {
      await tx.insert(doctorTimeOff).values(value.plannedLeave.map((leave) => ({
        doctorId,
        startsAt: new Date(leave.startsAt),
        endsAt: new Date(leave.endsAt),
        reason: leave.reason || null,
      })));
    }
  });
}

export async function submitDoctorApplication(input: unknown) {
  const doctor = await requireDoctor();
  const parsed = submitApplicationSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Accept all declarations to submit." };

  const profile = await ensureProfile(doctor.id);
  if (!["draft", "needs_info"].includes(profile.verificationStatus)) {
    return { ok: false as const, message: "This application has already been submitted." };
  }

  const complete = Boolean(
    profile.fullName && profile.phone && profile.city && profile.state &&
    profile.registrationNumber && profile.registrationCouncil && profile.registrationYear &&
    profile.departmentId && profile.qualifications.length && profile.yearsExperience !== null &&
    profile.languages.length && profile.consultModes.length,
  );
  const documents = await db.select({ type: doctorDocuments.type }).from(doctorDocuments).where(eq(doctorDocuments.doctorId, profile.id));
  const availableTypes = new Set(documents.map((document) => document.type));
  const hasRequiredDocuments = ["registration_certificate", "degree_certificate", "government_id", "profile_photo"]
    .every((type) => availableTypes.has(type as typeof documents[number]["type"]));
  if (!complete || !hasRequiredDocuments) {
    return { ok: false as const, message: "Complete every required section and upload all four required document types before submitting." };
  }

  await db.transaction(async (tx) => {
    await tx.update(doctorProfiles).set({
      verificationStatus: "submitted",
      verificationNotes: null,
      onboardingStep: 7,
      submittedAt: new Date(),
    }).where(eq(doctorProfiles.id, profile.id));
    await tx.insert(auditLogs).values({
      actorUserId: doctor.id,
      action: "doctor_application_submitted",
      entity: "doctor_profile",
      entityId: profile.id,
      meta: { acceptedTerms: true, acceptedDataProcessing: true, acceptedTelemedicineDeclaration: true },
    });
  });

  revalidatePath("/doctor/onboarding");
  revalidatePath("/admin/applications");
  return { ok: true as const };
}

export async function reviewDoctorApplication(input: unknown) {
  const admin = await requireAdmin();
  const parsed = reviewDecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid review action." };
  const decision = parsed.data;
  const [profile] = await db.select().from(doctorProfiles).where(eq(doctorProfiles.id, decision.doctorId)).limit(1);
  if (!profile) return { ok: false as const, message: "Application not found." };

  let verificationStatus: typeof profile.verificationStatus;
  let verificationNotes: string | null = null;
  if (decision.decision === "start_review") {
    if (profile.verificationStatus !== "submitted") return { ok: false as const, message: "Only submitted applications can enter review." };
    verificationStatus = "under_review";
  } else if (decision.decision === "approve") {
    if (!["submitted", "under_review"].includes(profile.verificationStatus)) return { ok: false as const, message: "This application is not awaiting approval." };
    verificationStatus = "verified";
  } else if (decision.decision === "request_info") {
    if (!["submitted", "under_review"].includes(profile.verificationStatus)) return { ok: false as const, message: "This application is not awaiting more information." };
    verificationStatus = "needs_info";
    verificationNotes = decision.message;
  } else {
    if (!["submitted", "under_review"].includes(profile.verificationStatus)) return { ok: false as const, message: "This application is not awaiting rejection." };
    verificationStatus = "rejected";
    verificationNotes = decision.reason;
  }

  const updated = await db.transaction(async (tx) => {
    const [changed] = await tx.update(doctorProfiles).set({
      verificationStatus,
      verificationNotes,
      verifiedAt: verificationStatus === "verified" ? new Date() : null,
      verifiedByUserId: verificationStatus === "verified" ? admin.id : null,
    }).where(and(eq(doctorProfiles.id, profile.id), eq(doctorProfiles.verificationStatus, profile.verificationStatus))).returning({ id: doctorProfiles.id });
    if (!changed) return false;
    await tx.insert(auditLogs).values({
      actorUserId: admin.id,
      action: `doctor_application_${decision.decision}`,
      entity: "doctor_profile",
      entityId: profile.id,
      meta: { status: verificationStatus },
    });
    return true;
  });

  if (!updated) return { ok: false as const, message: "Another reviewer changed this application. Refresh and try again." };

  revalidatePath("/admin/applications");
  revalidatePath(`/admin/applications/${profile.id}`);
  revalidatePath("/doctor/onboarding");
  revalidatePath("/doctor/dashboard");
  return { ok: true as const };
}

const doctorSoapFormSchema = z.object({
  appointmentId: z.uuid(),
  subjective: z.string().trim().max(4000),
  objective: z.string().trim().max(3000),
  assessment: z.string().trim().max(4000),
  plan: z.string().trim().max(4000),
  reviewed: z.boolean(),
});

export async function saveDoctorSoapNote(formData: FormData) {
  const doctor = await requireDoctor();
  const [profile] = await db.select({ id: doctorProfiles.id, verificationStatus: doctorProfiles.verificationStatus })
    .from(doctorProfiles).where(eq(doctorProfiles.userId, doctor.id)).limit(1);
  if (!profile || profile.verificationStatus !== "verified") throw new Error("Verified doctor access is required.");
  const parsed = doctorSoapFormSchema.safeParse({
    appointmentId: formData.get("appointmentId"),
    subjective: formData.get("subjective"),
    objective: formData.get("objective"),
    assessment: formData.get("assessment"),
    plan: formData.get("plan"),
    reviewed: formData.get("reviewed") === "on",
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the SOAP note.");
  const now = new Date();
  await db.transaction(async (tx) => {
    const [appointment] = await tx.select({ id: appointments.id }).from(appointments)
      .where(and(eq(appointments.id, parsed.data.appointmentId), eq(appointments.doctorId, profile.id), inArray(appointments.status, ["confirmed", "completed"]))).limit(1).for("update");
    if (!appointment) throw new Error("This patient is not assigned to your verified appointment queue.");
    await tx.insert(doctorSoapNotes).values({
      appointmentId: appointment.id,
      doctorId: profile.id,
      subjective: parsed.data.subjective,
      objective: parsed.data.objective,
      assessment: parsed.data.assessment,
      plan: parsed.data.plan,
      reviewedAt: parsed.data.reviewed ? now : null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: doctorSoapNotes.appointmentId,
      set: {
        subjective: parsed.data.subjective,
        objective: parsed.data.objective,
        assessment: parsed.data.assessment,
        plan: parsed.data.plan,
        reviewedAt: parsed.data.reviewed ? now : null,
        updatedAt: now,
      },
    });
    await tx.insert(auditLogs).values({
      actorUserId: doctor.id,
      action: parsed.data.reviewed ? "doctor_soap_note_reviewed" : "doctor_soap_note_saved",
      entity: "appointment",
      entityId: appointment.id,
      meta: null,
    });
  });
  revalidatePath("/doctor/dashboard");
}

const appointmentOutcomeSchema = z.object({ appointmentId: z.uuid(), outcome: z.enum(["completed", "no_show"]) });

export async function updateDoctorAppointmentOutcome(formData: FormData) {
  const doctor = await requireDoctor();
  const parsed = appointmentOutcomeSchema.safeParse({ appointmentId: formData.get("appointmentId"), outcome: formData.get("outcome") });
  if (!parsed.success) throw new Error("Choose a valid appointment outcome.");
  const [profile] = await db.select({ id: doctorProfiles.id, verificationStatus: doctorProfiles.verificationStatus })
    .from(doctorProfiles).where(eq(doctorProfiles.userId, doctor.id)).limit(1);
  if (!profile || profile.verificationStatus !== "verified") throw new Error("Verified doctor access is required.");
  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const [appointment] = await tx.select({ id: appointments.id, endsAt: appointments.endsAt, startsAt: appointments.startsAt }).from(appointments)
      .where(and(eq(appointments.id, parsed.data.appointmentId), eq(appointments.doctorId, profile.id), eq(appointments.status, "confirmed"))).limit(1).for("update");
    if (!appointment || (parsed.data.outcome === "completed" && appointment.endsAt > now) || (parsed.data.outcome === "no_show" && appointment.startsAt > now)) return false;
    const [changed] = await tx.update(appointments).set({ status: parsed.data.outcome, updatedAt: now })
      .where(and(eq(appointments.id, appointment.id), eq(appointments.status, "confirmed"))).returning({ id: appointments.id });
    if (!changed) return false;
    await tx.insert(auditLogs).values({ actorUserId: doctor.id, action: `doctor_appointment_${parsed.data.outcome}`, entity: "appointment", entityId: appointment.id, meta: null });
    return true;
  });
  if (!updated) throw new Error("This appointment is not ready for that outcome. Refresh and try again.");
  revalidatePath("/doctor/dashboard");
  revalidatePath("/patient/appointments");
}
