import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appointments, conversations, patientProfiles, triageAssessments } from "@/lib/db/schema";

export const runtime = "nodejs";

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !(origin && origin !== new URL(request.url).origin) && request.headers.get("sec-fetch-site") !== "cross-site";
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to continue this conversation." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });
  const { conversationId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  const [profile] = await db.select({ id: patientProfiles.id }).from(patientProfiles)
    .where(eq(patientProfiles.userId, session.user.id)).limit(1);
  if (!profile) return Response.json({ error: "Conversation not found." }, { status: 404 });
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.user.id}))`);
    const [conversation] = await tx.select({ id: conversations.id, status: conversations.status }).from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.patientId, profile.id)))
      .limit(1)
      .for("update");
    if (!conversation) return { kind: "not-found" as const };
    if (conversation.status !== "closed" && conversation.status !== "halted") return { kind: "not-closed" as const };

    const [triage] = await tx.select({ id: triageAssessments.id }).from(triageAssessments)
      .where(eq(triageAssessments.conversationId, conversationId)).limit(1);
    if (triage) {
      const [appointment] = await tx.select({ id: appointments.id }).from(appointments)
        .where(eq(appointments.triageId, triage.id)).limit(1);
      if (appointment) return { kind: "appointment-exists" as const };
      await tx.delete(triageAssessments).where(eq(triageAssessments.id, triage.id));
    }
    const [updated] = await tx.update(conversations).set({ status: "active", updatedAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.patientId, profile.id)))
      .returning({ id: conversations.id, status: conversations.status });
    return updated ? { kind: "reopened" as const, conversation: updated } : { kind: "not-found" as const };
  });

  if (result.kind === "not-found") return Response.json({ error: "Conversation not found." }, { status: 404 });
  if (result.kind === "not-closed") return Response.json({ error: "Only a finished conversation can be continued." }, { status: 409 });
  if (result.kind === "appointment-exists") return Response.json({ error: "This conversation has an appointment, so it cannot be reopened." }, { status: 409 });
  return Response.json({ conversation: result.conversation });
}
