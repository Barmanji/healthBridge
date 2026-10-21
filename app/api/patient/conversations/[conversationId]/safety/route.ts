import { and, desc, eq, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations, patientProfiles, riskEvents } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * Read-only safety state for one conversation.
 *
 * Voice calls are no longer ended when a turn looks risky, so the client needs a
 * way to show the red in-call indicator without re-reading the transcript. This
 * reports only whether a non-routine risk event exists; it never returns the
 * patient's words.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const session = await auth.api.getSession({ headers: _request.headers });
  if (!session) return Response.json({ error: "Sign in to view this conversation." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });

  const { conversationId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  const [profile] = await db.select({ id: patientProfiles.id }).from(patientProfiles)
    .where(eq(patientProfiles.userId, session.user.id)).limit(1);
  if (!profile) return Response.json({ error: "Conversation not found." }, { status: 404 });

  const [conversation] = await db.select({ id: conversations.id }).from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.patientId, profile.id)))
    .limit(1);
  if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });

  const [event] = await db.select({
    assessment: riskEvents.assessment,
    createdAt: riskEvents.createdAt,
  }).from(riskEvents)
    .where(and(
      eq(riskEvents.conversationId, conversationId),
      ne(riskEvents.assessment, "not_critical"),
    ))
    .orderBy(desc(riskEvents.createdAt))
    .limit(1);

  return Response.json({
    escalated: Boolean(event),
    assessment: event?.assessment ?? null,
    recordedAt: event?.createdAt ?? null,
  }, { status: 200 });
}
