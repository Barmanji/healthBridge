import { and, eq, gt, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appointments, auditLogs, patientProfiles } from "@/lib/db/schema";

export const runtime = "nodejs";

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

export async function POST(request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });
  const { appointmentId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appointmentId)) {
    return Response.json({ error: "Appointment not found." }, { status: 404 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [patient] = await tx.select({ id: patientProfiles.id }).from(patientProfiles).where(eq(patientProfiles.userId, session.user.id)).limit(1);
      if (!patient) return { kind: "not-found" as const };
      const [initial] = await tx.select({ doctorId: appointments.doctorId }).from(appointments)
        .where(and(eq(appointments.id, appointmentId), eq(appointments.patientId, patient.id))).limit(1);
      if (!initial) return { kind: "not-found" as const };
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.user.id}))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${initial.doctorId}))`);
      const [appointment] = await tx.select().from(appointments)
        .where(and(eq(appointments.id, appointmentId), eq(appointments.patientId, patient.id))).limit(1).for("update");
      if (!appointment) return { kind: "not-found" as const };
      if (appointment.status === "confirmed") return { kind: "confirmed" as const };
      const now = new Date();
      if (appointment.status !== "held" || !appointment.holdExpiresAt || appointment.holdExpiresAt <= now || appointment.startsAt <= now) {
        if (appointment.status === "held") {
          await tx.update(appointments).set({ status: "expired", holdExpiresAt: null, updatedAt: now }).where(eq(appointments.id, appointment.id));
        }
        return { kind: "expired" as const };
      }
      const [confirmed] = await tx.update(appointments).set({
        status: "confirmed",
        holdExpiresAt: null,
        confirmedByPatientAt: now,
        updatedAt: now,
      }).where(and(eq(appointments.id, appointment.id), eq(appointments.status, "held"), gt(appointments.holdExpiresAt, now), gt(appointments.startsAt, now)))
        .returning({ id: appointments.id, startsAt: appointments.startsAt, endsAt: appointments.endsAt, consultMode: appointments.consultMode });
      if (!confirmed) return { kind: "expired" as const };
      const previousAppointments = appointment.triageId ? await tx.select({ id: appointments.id }).from(appointments)
        .where(and(
          eq(appointments.patientId, patient.id),
          eq(appointments.triageId, appointment.triageId),
          eq(appointments.status, "confirmed"),
        )) : [];
      for (const previous of previousAppointments) {
        if (previous.id === confirmed.id) continue;
        await tx.update(appointments).set({ status: "cancelled", confirmedByPatientAt: null, cancelledAt: now, updatedAt: now }).where(eq(appointments.id, previous.id));
        await tx.insert(auditLogs).values({ actorUserId: session.user.id, action: "appointment.rescheduled", entity: "appointment", entityId: previous.id, meta: { replacedBy: confirmed.id } });
      }
      await tx.insert(auditLogs).values({ actorUserId: session.user.id, action: "appointment.patient_confirmed", entity: "appointment", entityId: confirmed.id, meta: { consultMode: confirmed.consultMode } });
      return { kind: "confirmed" as const, appointment: confirmed };
    });
    if (result.kind === "not-found") return Response.json({ error: "Appointment not found." }, { status: 404 });
    if (result.kind === "expired") return Response.json({ error: "The one-minute hold expired. Please choose another time." }, { status: 409 });
    return Response.json({ appointment: result.appointment ?? null, status: "confirmed" });
  } catch {
    return Response.json({ error: "We could not confirm this appointment. Please refresh and try again." }, { status: 503 });
  }
}
