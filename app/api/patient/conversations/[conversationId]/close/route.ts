import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversationMessages, conversations, patientProfiles } from "@/lib/db/schema";

export const runtime = "nodejs";

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !(origin && origin !== new URL(request.url).origin) && request.headers.get("sec-fetch-site") !== "cross-site";
}

export async function DELETE(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to remove this empty conversation." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });
  const { conversationId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  const [profile] = await db.select({ id: patientProfiles.id }).from(patientProfiles)
    .where(eq(patientProfiles.userId, session.user.id)).limit(1);
  if (!profile) return Response.json({ error: "Conversation not found." }, { status: 404 });
  const result = await db.transaction(async (tx) => {
    // Use the same per-patient lock as message writes so an in-flight voice
    // transcript cannot race with deletion of an apparently empty thread.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.user.id}))`);
    const [patientMessage] = await tx.select({ id: conversationMessages.id }).from(conversationMessages)
      .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.role, "patient")))
      .limit(1);
    if (patientMessage) return "has-messages" as const;
    const [deleted] = await tx.delete(conversations).where(and(
      eq(conversations.id, conversationId),
      eq(conversations.patientId, profile.id),
    )).returning({ id: conversations.id });
    return deleted ? "deleted" as const : "not-found" as const;
  });
  if (result === "has-messages") return Response.json({ error: "A conversation with messages cannot be removed this way." }, { status: 409 });
  return result === "deleted" ? new Response(null, { status: 204 }) : Response.json({ error: "Conversation not found." }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to finish this conversation." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });
  const { conversationId } = await params;
  const [profile] = await db.select({ id: patientProfiles.id }).from(patientProfiles)
    .where(eq(patientProfiles.userId, session.user.id)).limit(1);
  if (!profile) return Response.json({ error: "Conversation not found." }, { status: 404 });
  const [conversation] = await db.update(conversations).set({ status: "closed", updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.patientId, profile.id), eq(conversations.status, "active")))
    .returning({ id: conversations.id, status: conversations.status });
  if (!conversation) {
    const [existing] = await db.select({ id: conversations.id, status: conversations.status }).from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.patientId, profile.id))).limit(1);
    if (!existing) return Response.json({ error: "Conversation not found." }, { status: 404 });
    return Response.json({ conversation: existing });
  }
  return Response.json({ conversation });
}
