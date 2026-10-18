"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { patientProfiles, user } from "@/lib/db/schema";
import { patientProfileSchema, patientOnboardingSchema } from "@/modules/patient/schemas";

const PATIENT_ONBOARDING_CONSENT_VERSION = "patient-profile-v1";

export async function updatePatientProfile(input: unknown) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "patient") return { ok: false as const, message: "Sign in with a patient account to update this profile." };
  const parsed = patientProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Check your profile details." };
  const updatedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.update(user).set({ name: parsed.data.name }).where(eq(user.id, session.user.id));
    await tx.update(patientProfiles).set({
      preferredLanguage: parsed.data.preferredLanguage,
      emergencyContactName: parsed.data.emergencyContactName || null,
      emergencyContactPhone: parsed.data.emergencyContactPhone || null,
      updatedAt,
    }).where(eq(patientProfiles.userId, session.user.id));
  });
  revalidatePath("/patient/settings");
  revalidatePath("/patient/dashboard");
  revalidatePath("/");
  return { ok: true as const, message: "Your profile was updated." };
}

export async function completePatientOnboarding(input: unknown) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "patient") {
    return { ok: false as const, message: "Sign in with a patient account to continue." };
  }

  const parsed = patientOnboardingSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      ok: false as const,
      message: Object.values(fieldErrors).flat()[0] ?? "Check your details and try again.",
    };
  }

  const acceptedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.update(user).set({ name: parsed.data.name }).where(eq(user.id, session.user.id));
    await tx.insert(patientProfiles).values({
      userId: session.user.id,
      preferredLanguage: parsed.data.preferredLanguage,
      emergencyContactName: parsed.data.emergencyContactName || null,
      emergencyContactPhone: parsed.data.emergencyContactPhone || null,
      consentAcceptedAt: acceptedAt,
      consentVersion: PATIENT_ONBOARDING_CONSENT_VERSION,
      onboardingCompletedAt: acceptedAt,
    }).onConflictDoUpdate({
      target: patientProfiles.userId,
      set: {
        preferredLanguage: parsed.data.preferredLanguage,
        emergencyContactName: parsed.data.emergencyContactName || null,
        emergencyContactPhone: parsed.data.emergencyContactPhone || null,
        consentAcceptedAt: acceptedAt,
        consentVersion: PATIENT_ONBOARDING_CONSENT_VERSION,
        onboardingCompletedAt: acceptedAt,
        updatedAt: acceptedAt,
      },
    });
  });

  revalidatePath("/patient");
  revalidatePath("/patient/dashboard");
  return { ok: true as const, message: "Your patient profile is ready." };
}
