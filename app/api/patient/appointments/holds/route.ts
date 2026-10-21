import { and, eq, gte, lte, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { generateAvailableSlots } from "@/lib/appointments/scheduling";
import { db } from "@/lib/db";
import { appointments, auditLogs, conversations, doctorAvailabilityRules, doctorProfiles, doctorTimeOff, patientProfiles, triageAssessments } from "@/lib/db/schema";

export const runtime = "nodejs";

const holdSchema = z.object({
  doctorId: z.uuid(),
  triageId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  consultMode: z.enum(["video", "audio"]),
}).strict();

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 2048) return Response.json({ error: "Request is too large." }, { status: 413 });
    body = JSON.parse(raw) as unknown;
  } catch { return Response.json({ error: "Submit a valid request." }, { status: 400 }); }
  const parsed = holdSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the selected doctor and time." }, { status: 400 });
  const startsAt = new Date(parsed.data.startsAt);
  const now = new Date();

  try {
    const appointment = await db.transaction(async (tx) => {
      const [patient] = await tx.select({ id: patientProfiles.id }).from(patientProfiles)
        .where(eq(patientProfiles.userId, session.user.id)).limit(1);
      if (!patient) return { kind: "profile-missing" as const };

      // Lock in a consistent order: one active hold per patient, then one slot owner at a time.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.user.id}))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${parsed.data.doctorId}))`);
      const [doctor] = await tx.select({
        id: doctorProfiles.id,
        status: doctorProfiles.verificationStatus,
        timeZone: doctorProfiles.timeZone,
        slotMinutes: doctorProfiles.slotMinutes,
        bufferMinutes: doctorProfiles.bufferMinutes,
        consultModes: doctorProfiles.consultModes,
      }).from(doctorProfiles).where(eq(doctorProfiles.id, parsed.data.doctorId)).limit(1);
      if (!doctor || doctor.status !== "verified" || !doctor.consultModes.includes(parsed.data.consultMode)) return { kind: "unavailable" as const };

      const [triage] = await tx.select({ id: triageAssessments.id, patientId: triageAssessments.patientId, severity: triageAssessments.severity, conversationStatus: conversations.status })
        .from(triageAssessments).innerJoin(conversations, eq(conversations.id, triageAssessments.conversationId))
        .where(and(eq(triageAssessments.id, parsed.data.triageId), eq(triageAssessments.patientId, patient.id))).limit(1);
      if (!triage) return { kind: "unavailable" as const };

      await tx.update(appointments).set({ status: "expired", holdExpiresAt: null, updatedAt: now })
        .where(and(eq(appointments.patientId, patient.id), eq(appointments.status, "held"), lte(appointments.holdExpiresAt, now)));
      await tx.update(appointments).set({ status: "expired", holdExpiresAt: null, updatedAt: now })
        .where(and(eq(appointments.doctorId, doctor.id), eq(appointments.status, "held"), lte(appointments.holdExpiresAt, now)));
      const [rules, leave, booked] = await Promise.all([
        tx.select({ weekday: doctorAvailabilityRules.weekday, startTime: doctorAvailabilityRules.startTime, endTime: doctorAvailabilityRules.endTime })
          .from(doctorAvailabilityRules).where(eq(doctorAvailabilityRules.doctorId, doctor.id)),
        tx.select({ startsAt: doctorTimeOff.startsAt, endsAt: doctorTimeOff.endsAt }).from(doctorTimeOff)
          .where(and(eq(doctorTimeOff.doctorId, doctor.id), lt(doctorTimeOff.startsAt, new Date(now.getTime() + 15 * 86_400_000)), gte(doctorTimeOff.endsAt, now))),
        tx.select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt }).from(appointments).where(and(
          eq(appointments.doctorId, doctor.id),
          or(eq(appointments.status, "confirmed"), eq(appointments.status, "held")),
          lt(appointments.startsAt, new Date(now.getTime() + 15 * 86_400_000)),
          gte(appointments.endsAt, now),
        )),
      ]);
      let available = false;
      try {
        available = generateAvailableSlots({ rules, timeOff: leave, booked, timeZone: doctor.timeZone, slotMinutes: doctor.slotMinutes, bufferMinutes: doctor.bufferMinutes, now, limit: 1000 })
          .some((slot) => slot.startsAt.getTime() === startsAt.getTime());
      } catch {
        return { kind: "unavailable" as const };
      }
      if (!available) return { kind: "unavailable" as const };

      // Preserve the patient's existing hold unless the replacement time is actually available.
      await tx.update(appointments).set({ status: "expired", holdExpiresAt: null, updatedAt: now })
        .where(and(eq(appointments.patientId, patient.id), eq(appointments.status, "held")));

      const holdExpiresAt = new Date(now.getTime() + 60_000);
      const [created] = await tx.insert(appointments).values({
        patientId: patient.id,
        doctorId: doctor.id,
        triageId: triage.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + doctor.slotMinutes * 60_000),
        status: "held",
        holdExpiresAt,
        consultMode: parsed.data.consultMode,
      }).returning({ id: appointments.id, startsAt: appointments.startsAt, endsAt: appointments.endsAt, holdExpiresAt: appointments.holdExpiresAt, consultMode: appointments.consultMode });
      await tx.insert(auditLogs).values({
        actorUserId: session.user.id,
        action: "appointment.slot_held",
        entity: "appointment",
        entityId: created.id,
        meta: { consultMode: created.consultMode },
      });
      return { kind: "held" as const, appointment: created, timeZone: doctor.timeZone };
    });

    if (appointment.kind === "profile-missing") return Response.json({ error: "Complete patient onboarding before choosing a slot." }, { status: 409 });
    if (appointment.kind === "unavailable") return Response.json({ error: "That time is no longer available. Choose another slot." }, { status: 409 });
    return Response.json({ appointment: { ...appointment.appointment, startsAt: appointment.appointment.startsAt.toISOString(), endsAt: appointment.appointment.endsAt.toISOString(), holdExpiresAt: appointment.appointment.holdExpiresAt?.toISOString() ?? null }, timeZone: appointment.timeZone }, { status: 201 });
  } catch {
    // Do not return database errors or health details; unique-index conflicts are unavailable slots.
    return Response.json({ error: "That time is no longer available. Choose another slot." }, { status: 409 });
  }
}
