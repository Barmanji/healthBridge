import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations, patientProfiles } from "@/lib/db/schema";
import { conversationTitleSchema } from "@/modules/patient/schemas";

export const runtime = "nodejs";

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

/**
 * Rename a conversation. Marks the title as patient-set, which stops the
 * automatic naming job from ever overwriting it.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to rename this conversation." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });

  const { conversationId: rawId } = await params;
  const parsed = conversationTitleSchema.safeParse({ conversationId: rawId, title: (await request.json().catch(() => ({})) as { title?: unknown }).title });
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Choose a shorter title." }, { status: 400 });

  const [profile] = await db.select({ id: patientProfiles.id }).from(patientProfiles)
    .where(eq(patientProfiles.userId, session.user.id)).limit(1);
  if (!profile) return Response.json({ error: "Conversation not found." }, { status: 404 });

  const [updated] = await db.update(conversations).set({
    title: parsed.data.title,
    titleSource: "patient",
    titleUpdatedAt: new Date(),
  }).where(and(
    eq(conversations.id, parsed.data.conversationId),
    eq(conversations.patientId, profile.id),
  )).returning({ id: conversations.id, title: conversations.title });
  if (!updated) return Response.json({ error: "Conversation not found." }, { status: 404 });

  return Response.json({ conversation: updated }, { status: 200 });
}

/** Persist a neutral fallback while the asynchronous AI title is still pending. */
export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to update this conversation." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });

  const { conversationId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  const [profile] = await db.select({ id: patientProfiles.id }).from(patientProfiles)
    .where(eq(patientProfiles.userId, session.user.id)).limit(1);
  if (!profile) return Response.json({ error: "Conversation not found." }, { status: 404 });
  const [updated] = await db.update(conversations).set({ title: "Health check-in", titleUpdatedAt: new Date() })
    .where(and(
      eq(conversations.id, conversationId),
      eq(conversations.patientId, profile.id),
      eq(conversations.titleSource, "auto"),
      isNull(conversations.title),
    )).returning({ id: conversations.id, title: conversations.title });
  if (updated) return Response.json({ conversation: updated }, { headers: { "Cache-Control": "no-store" } });
  const [conversation] = await db.select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.patientId, profile.id)))
    .limit(1);
  return conversation
    ? Response.json({ conversation }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "Conversation not found." }, { status: 404 });
}

/** Read the current auto-generated title so an open workspace can update without a route refresh. */
export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to view this conversation." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });

  const { conversationId } = await params;
  const [profile] = await db.select({ id: patientProfiles.id }).from(patientProfiles)
    .where(eq(patientProfiles.userId, session.user.id)).limit(1);
  if (!profile) return Response.json({ error: "Conversation not found." }, { status: 404 });
  const [conversation] = await db.select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.patientId, profile.id)))
    .limit(1);
  if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });
  return Response.json({ conversation }, { headers: { "Cache-Control": "no-store" } });
}
