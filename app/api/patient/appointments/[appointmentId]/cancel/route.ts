import { and, eq, gt, inArray } from "drizzle-orm";
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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appointmentId)) return Response.json({ error: "Appointment not found." }, { status: 404 });

  const [patient] = await db.select({ id: patientProfiles.id }).from(patientProfiles).where(eq(patientProfiles.userId, session.user.id)).limit(1);
  if (!patient) return Response.json({ error: "Appointment not found." }, { status: 404 });
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [cancelled] = await tx.update(appointments).set({
      status: "cancelled",
      holdExpiresAt: null,
      confirmedByPatientAt: null,
      cancelledAt: now,
      updatedAt: now,
    }).where(and(eq(appointments.id, appointmentId), eq(appointments.patientId, patient.id), gt(appointments.startsAt, now), inArray(appointments.status, ["held", "confirmed"])))
      .returning({ id: appointments.id, startsAt: appointments.startsAt });
    if (!cancelled) return null;
    await tx.insert(auditLogs).values({ actorUserId: session.user.id, action: "appointment.patient_cancelled", entity: "appointment", entityId: cancelled.id, meta: null });
    return cancelled;
  });
  if (!result) return Response.json({ error: "This appointment cannot be cancelled. Refresh and check its status." }, { status: 409 });
  return Response.json({ status: "cancelled" });
}
