import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLogs, conversations, patientProfiles, voiceSessions } from "@/lib/db/schema";
import { z } from "zod";

export const runtime = "nodejs";

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

function validConversationId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to start voice mode." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });
  const { conversationId } = await params;
  if (!validConversationId(conversationId)) return Response.json({ error: "Conversation not found." }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Confirm voice processing consent to continue." }, { status: 400 }); }
  const consent = z.object({ voiceProcessingConsent: z.literal(true) }).safeParse(body);
  if (!consent.success) return Response.json({ error: "Confirm voice processing consent to continue." }, { status: 400 });

  const [owned] = await db.select({ id: conversations.id, status: conversations.status })
    .from(conversations)
    .innerJoin(patientProfiles, eq(patientProfiles.id, conversations.patientId))
    .where(and(eq(conversations.id, conversationId), eq(patientProfiles.userId, session.user.id)))
    .limit(1);
  if (!owned) return Response.json({ error: "Conversation not found." }, { status: 404 });
  if (owned.status !== "active") return Response.json({ error: "This conversation is finished. Continue it before starting voice mode." }, { status: 409 });

  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  if (!publicKey || !assistantId) return Response.json({ error: "Voice mode is not configured. You can continue by typing." }, { status: 503 });

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const consentAt = new Date();
  await db.insert(voiceSessions).values({ conversationId, tokenHash, consentAt, expiresAt });
  await db.insert(auditLogs).values({
    actorUserId: session.user.id,
    action: "conversation.voice_session_started",
    entity: "conversation",
    entityId: conversationId,
    meta: { expiresInMinutes: 15, voiceProcessingConsent: true },
  });

  // Vapi's cloud must reach this app over public HTTPS, which is a different
  // requirement from the URL the browser and Better Auth use. Keeping them in
  // separate variables lets you browse on localhost while voice stays reachable.
  const configuredOrigin =
    process.env.VAPI_CALLBACK_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  const baseOrigin = configuredOrigin || new URL(request.url).origin;
  const apiBaseUrl = `${baseOrigin.replace(/\/$/, "")}/api/vapi/v1`;
  return Response.json({ token: rawToken, publicKey, assistantId, apiBaseUrl, expiresAt: expiresAt.toISOString() }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || session.user.role !== "patient") return Response.json({ error: "Sign in with a patient account." }, { status: 401 });
  const { conversationId } = await params;
  if (!validConversationId(conversationId)) return Response.json({ error: "Conversation not found." }, { status: 404 });
  const [owned] = await db.select({ id: conversations.id })
    .from(conversations)
    .innerJoin(patientProfiles, eq(patientProfiles.id, conversations.patientId))
    .where(and(eq(conversations.id, conversationId), eq(patientProfiles.userId, session.user.id)))
    .limit(1);
  if (!owned) return Response.json({ error: "Conversation not found." }, { status: 404 });

  const revokedAt = new Date();
  await db.update(voiceSessions).set({ revokedAt }).where(and(
    eq(voiceSessions.conversationId, conversationId),
    isNull(voiceSessions.revokedAt),
    gt(voiceSessions.expiresAt, revokedAt),
  ));
  return Response.json({ ok: true });
}
