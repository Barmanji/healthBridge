import { and, desc, eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { evaluateConversationTurn, type ConversationContextMessage } from "@/lib/ai/conversation-turn";
import { classifyAndStoreTurn } from "@/lib/ml/store";
import { refreshConversationTitle } from "@/lib/conversations/title-store";
import { db } from "@/lib/db";
import {
  conversationMessages,
  conversations,
  patientProfiles,
} from "@/lib/db/schema";
import { conversationMessageSchema } from "@/modules/patient/schemas";

export const runtime = "nodejs";
export const maxDuration = 20;

const maxBodyBytes = 12 * 1024;
const fallbackMessage = "I'm listening. What else would you like me to know?";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });

  const { conversationId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  const [profile] = await db.select({ id: patientProfiles.id }).from(patientProfiles)
    .where(eq(patientProfiles.userId, session.user.id)).limit(1);
  if (!profile) return Response.json({ error: "Conversation not found." }, { status: 404 });
  const [ownedConversation] = await db.select({ id: conversations.id, status: conversations.status })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.patientId, profile.id)))
    .limit(1);
  if (!ownedConversation) return Response.json({ error: "Conversation not found." }, { status: 404 });

  const messages = await db.select({
    id: conversationMessages.id,
    role: conversationMessages.role,
    modality: conversationMessages.modality,
    content: conversationMessages.content,
    contentEnglish: conversationMessages.contentEnglish,
    languageCode: conversationMessages.languageCode,
    createdAt: conversationMessages.createdAt,
  }).from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    // Rows created in one turn share Postgres's transaction timestamp. Fetch
    // assistant rows first for a descending query, so reversing the result
    // keeps each patient message directly before its reply.
    .orderBy(
      desc(conversationMessages.createdAt),
      desc(sql`case when ${conversationMessages.role} = 'patient' then 0 when ${conversationMessages.role} = 'assistant' then 1 else 2 end`),
    )
    .limit(100);
  return Response.json({ status: ownedConversation.status, messages: messages.reverse().map((message) => ({ ...message, createdAt: message.createdAt.toISOString() })) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

async function readJson(request: Request): Promise<unknown | null> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBodyBytes) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBodyBytes) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });

  const { conversationId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  const body = await readJson(request);
  if (body === null) return Response.json({ error: "Send a valid message under 12 KB." }, { status: 400 });
  const parsed = conversationMessageSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check your message." }, { status: 400 });
  if (parsed.data.modality !== "text") return Response.json({ error: "Voice messages must come through a verified Vapi session." }, { status: 400 });

  try {
    const result = await db.transaction(async (tx) => {
      // Serialize a patient's turns so duplicate or concurrent requests cannot spend extra model calls.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.user.id}))`);
      const [ownedConversation] = await tx.select({
        id: conversations.id,
        patientId: conversations.patientId,
        languageCode: conversations.languageCode,
        status: conversations.status,
      }).from(conversations)
        .innerJoin(patientProfiles, eq(patientProfiles.id, conversations.patientId))
        .where(and(eq(conversations.id, conversationId), eq(patientProfiles.userId, session.user.id)))
        .limit(1)
        .for("update");
      if (!ownedConversation) return { kind: "not-found" as const };

      const [existing] = await tx.select({ id: conversationMessages.id, role: conversationMessages.role, modality: conversationMessages.modality, content: conversationMessages.content, contentEnglish: conversationMessages.contentEnglish, languageCode: conversationMessages.languageCode, createdAt: conversationMessages.createdAt })
        .from(conversationMessages)
        .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.clientMessageId, parsed.data.clientMessageId)))
        .limit(1);
      if (existing) {
        const [assistant] = await tx.select({ id: conversationMessages.id, role: conversationMessages.role, modality: conversationMessages.modality, content: conversationMessages.content, contentEnglish: conversationMessages.contentEnglish, languageCode: conversationMessages.languageCode, createdAt: conversationMessages.createdAt })
          .from(conversationMessages)
          .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.replyToMessageId, existing.id)))
          .limit(1);
        return { kind: "duplicate" as const, patientMessage: existing, assistantMessage: assistant ?? null, status: ownedConversation.status };
      }
      if (ownedConversation.status !== "active") return { kind: "inactive" as const };

      const historyRows = await tx.select({ role: conversationMessages.role, content: conversationMessages.content })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversationId))
        .orderBy(
          desc(conversationMessages.createdAt),
          desc(sql`case when ${conversationMessages.role} = 'patient' then 0 when ${conversationMessages.role} = 'assistant' then 1 else 2 end`),
        )
        .limit(40);
      const context: ConversationContextMessage[] = historyRows.reverse()
        .filter((message): message is typeof message & { role: "patient" | "assistant" } => message.role === "patient" || message.role === "assistant")
        .map((message) => ({ role: message.role, content: message.content }));

      const [patientMessage] = await tx.insert(conversationMessages).values({
        conversationId,
        clientMessageId: parsed.data.clientMessageId,
        role: "patient",
        modality: parsed.data.modality,
        languageCode: parsed.data.languageCode,
        content: parsed.data.content,
        vapiCallId: parsed.data.vapiCallId ?? null,
      }).returning({ id: conversationMessages.id, role: conversationMessages.role, modality: conversationMessages.modality, content: conversationMessages.content, contentEnglish: conversationMessages.contentEnglish, languageCode: conversationMessages.languageCode, createdAt: conversationMessages.createdAt });

      let languageCode = parsed.data.languageCode;
      let englishTranslation: string | null = null;
      let assistantEnglishTranslation: string | null = null;
      let assistantText = fallbackMessage;
      let intakeComplete = false;
      try {
        const turn = await evaluateConversationTurn(context, parsed.data.content);
        languageCode = turn.detectedLanguageCode;
        englishTranslation = turn.englishTranslation;
        assistantEnglishTranslation = turn.replyEnglishTranslation;
        assistantText = turn.reply;
        intakeComplete = turn.intakeComplete;
      } catch {
        // Keep the conversation active if language processing is temporarily unavailable.
      }

      await tx.update(conversationMessages).set({
        languageCode,
        contentEnglish: englishTranslation,
      }).where(eq(conversationMessages.id, patientMessage.id));
      const [assistantMessage] = await tx.insert(conversationMessages).values({
        conversationId,
        replyToMessageId: patientMessage.id,
        role: "assistant",
        modality: "text",
        languageCode,
        content: assistantText,
        contentEnglish: assistantEnglishTranslation,
      }).returning({ id: conversationMessages.id, role: conversationMessages.role, modality: conversationMessages.modality, content: conversationMessages.content, contentEnglish: conversationMessages.contentEnglish, languageCode: conversationMessages.languageCode, createdAt: conversationMessages.createdAt });

      const nextStatus = intakeComplete ? "closed" as const : "active" as const;
      await tx.update(conversations).set({ languageCode, status: nextStatus, updatedAt: new Date() }).where(eq(conversations.id, conversationId));
      return {
        kind: "processed" as const,
        patientMessage: { ...patientMessage, contentEnglish: englishTranslation, languageCode },
        assistantMessage: assistantMessage ?? null,
        status: nextStatus,
        languageCode,
      };
    });

    if (result.kind === "not-found") return Response.json({ error: "Conversation not found." }, { status: 404 });
    if (result.kind === "inactive") return Response.json({ error: "Continue this conversation before sending another message." }, { status: 409 });
    if (result.kind === "processed") {
      const messageId = result.patientMessage.id;
      const text = result.patientMessage.content;
      const languageCode = result.languageCode;
      after(() => classifyAndStoreTurn({ messageId, conversationId, text, languageCode }));
      // Sidebar label only. Failures are swallowed inside the helper.
      after(() => refreshConversationTitle(conversationId).catch(() => {}));
    }

    return Response.json(result, { status: 200 });
  } catch {
    // Provider/database details and health information are intentionally not returned or logged.
    return Response.json({ error: "We could not process this message. Please try again." }, { status: 503 });
  }
}
