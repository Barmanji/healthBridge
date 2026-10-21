import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { evaluateConversationTurn, type ConversationContextMessage } from "@/lib/ai/conversation-turn";
import { classifyAndStoreTurn } from "@/lib/ml/store";
import { refreshConversationTitle } from "@/lib/conversations/title-store";
import { db } from "@/lib/db";
import {
  conversationMessages,
  conversations,
  patientProfiles,
  voiceSessions,
} from "@/lib/db/schema";

export const runtime = "nodejs";
export const maxDuration = 20;

// Vapi can send a full turn history. Thirty two messages at the supported
// per-message limit can exceed 32 KB, so leave room for the full request and
// bound the actual model context after parsing.
const maxBodyBytes = 128 * 1024;
const defaultVoiceFallback = "I'm listening. What else would you like me to know?";

function voiceFallback(languageCode: string | null | undefined) {
  const language = languageCode?.toLowerCase().split("-")[0];
  const localized: Record<string, string> = {
    en: defaultVoiceFallback,
    hi: "Main sun rahi hoon. Aap bataiye, aur kya jaanana zaroori hai?",
    bn: "আমি শুনছি। আর কী জানা জরুরি?",
    mr: "मी ऐकत आहे. आणखी काय जाणून घेणे महत्त्वाचे आहे?",
    te: "నేను వింటున్నాను. ఇంకా ఏం తెలుసుకోవడం ముఖ్యం?",
    ta: "நான் கேட்கிறேன். மேலும் என்ன தெரிந்துகொள்வது முக்கியம்?",
    gu: "હું સાંભળી રહી છું. હજી શું જાણવું જરૂરી છે?",
    kn: "ನಾನು ಕೇಳುತ್ತಿದ್ದೇನೆ. ಇನ್ನೇನು ತಿಳಿದುಕೊಳ್ಳುವುದು ಮುಖ್ಯ?",
    ml: "ഞാൻ കേൾക്കുന്നുണ്ട്. ഇനി എന്താണ് അറിയേണ്ടത്?",
    pa: "ਮੈਂ ਸੁਣ ਰਹੀ ਹਾਂ। ਹੋਰ ਕੀ ਜਾਣਨਾ ਜ਼ਰੂਰੀ ਹੈ?",
    ur: "میں سن رہی ہوں۔ اور کیا جاننا ضروری ہے؟",
  };
  return { content: localized[language ?? ""] ?? defaultVoiceFallback, english: defaultVoiceFallback };
}

const payloadSchema = z.object({
  messages: z.array(z.object({
    role: z.string().max(30),
    content: z.unknown(),
  })).min(1).max(32),
  stream: z.boolean().optional(),
  call: z.object({ id: z.string().min(1).max(128) }).optional(),
});

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string") return [part.text];
    return [];
  }).join(" ");
}

function deterministicMessageId(voiceSessionId: string, callId: string | undefined, userTurn: number) {
  const bytes = createHash("sha256").update(`${voiceSessionId}:${callId ?? "no-call-id"}:${userTurn}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function responseBody(content: string) {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  return {
    id,
    object: "chat.completion",
    created,
    model: "health-bridge-intake",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  };
}

function response(requestedStream: boolean, content: string) {
  const result = responseBody(content);
  if (!requestedStream) return Response.json(result);
  const created = result.created;
  const model = result.model;
  const id = result.id;
  const chunks = [
    { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] },
    { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

async function parseBody(request: Request) {
  const size = Number(request.headers.get("content-length"));
  if (Number.isFinite(size) && size > maxBodyBytes) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBodyBytes) return null;
  try { return payloadSchema.safeParse(JSON.parse(raw)); } catch { return null; }
}

export async function POST(request: Request) {
  const token = request.headers.get("x-health-bridge-voice-session");
  if (!token || token.length > 200) return Response.json({ error: { message: "Voice session authentication failed." } }, { status: 401 });
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const body = await parseBody(request);
  if (!body) return Response.json({ error: { message: "Invalid request." } }, { status: 400 });
  if (!body.success) return Response.json({ error: { message: "Invalid request." } }, { status: 400 });

  const turns = body.data.messages.filter((message) => message.role === "user");
  const latest = turns.at(-1);
  const content = latest ? contentToText(latest.content).trim() : "";
  if (!content || content.length > 1800) return Response.json({ error: { message: "A final transcript is required." } }, { status: 400 });
  const callId = body.data.call?.id;

  const now = new Date();
  const [voiceSession] = await db.select({
    id: voiceSessions.id,
    conversationId: voiceSessions.conversationId,
  }).from(voiceSessions)
    .where(and(eq(voiceSessions.tokenHash, tokenHash), gt(voiceSessions.expiresAt, now), isNull(voiceSessions.revokedAt)))
    .limit(1);
  if (!voiceSession) return Response.json({ error: { message: "Voice session expired. Continue by typing." } }, { status: 401 });

  const userTurn = turns.length;
  const clientMessageId = deterministicMessageId(voiceSession.id, callId, userTurn);
  try {
    const result = await db.transaction(async (tx) => {
      const [owner] = await tx.select({ userId: patientProfiles.userId })
        .from(conversations)
        .innerJoin(patientProfiles, eq(patientProfiles.id, conversations.patientId))
        .where(eq(conversations.id, voiceSession.conversationId))
        .limit(1);
      if (!owner) return { kind: "unavailable" as const };
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${owner.userId}))`);
      const [lockedVoiceSession] = await tx.select({ revokedAt: voiceSessions.revokedAt, expiresAt: voiceSessions.expiresAt, vapiCallId: voiceSessions.vapiCallId })
        .from(voiceSessions)
        .where(eq(voiceSessions.id, voiceSession.id))
        .limit(1)
        .for("update");
      if (!lockedVoiceSession || lockedVoiceSession.revokedAt || lockedVoiceSession.expiresAt <= new Date()) return { kind: "unavailable" as const };
      const [locked] = await tx.select({ status: conversations.status, languageCode: conversations.languageCode })
        .from(conversations)
        .where(eq(conversations.id, voiceSession.conversationId))
        .limit(1)
        .for("update");
      if (!locked) return { kind: "unavailable" as const };

      if (lockedVoiceSession.vapiCallId && callId && lockedVoiceSession.vapiCallId !== callId) return { kind: "unavailable" as const };
      if (!lockedVoiceSession.vapiCallId && callId) {
        await tx.update(voiceSessions).set({ vapiCallId: callId }).where(eq(voiceSessions.id, voiceSession.id));
      }

      const [existing] = await tx.select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(and(eq(conversationMessages.conversationId, voiceSession.conversationId), eq(conversationMessages.clientMessageId, clientMessageId)))
        .limit(1);
      if (existing) {
        const [reply] = await tx.select({ content: conversationMessages.content })
          .from(conversationMessages)
          .where(and(eq(conversationMessages.conversationId, voiceSession.conversationId), eq(conversationMessages.replyToMessageId, existing.id)))
          .limit(1);
        return { kind: "complete" as const, content: reply?.content ?? voiceFallback(locked.languageCode).content };
      }
      if (locked.status !== "active") return { kind: "complete" as const, content: "" };

      const historyRows = await tx.select({ role: conversationMessages.role, content: conversationMessages.content })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, voiceSession.conversationId))
        .orderBy(
          desc(conversationMessages.createdAt),
          desc(sql`case when ${conversationMessages.role} = 'patient' then 0 when ${conversationMessages.role} = 'assistant' then 1 else 2 end`),
        )
        .limit(40);
      const history: ConversationContextMessage[] = historyRows.reverse()
        .filter((message): message is typeof message & { role: "patient" | "assistant" } => message.role === "patient" || message.role === "assistant")
        .map((message) => ({ role: message.role, content: message.content }));

      const [patientMessage] = await tx.insert(conversationMessages).values({
        conversationId: voiceSession.conversationId,
        clientMessageId,
        role: "patient",
        modality: "voice",
        languageCode: "und",
        content,
        vapiCallId: callId ?? null,
      }).returning({ id: conversationMessages.id });

      let languageCode = locked.languageCode;
      let englishTranslation: string | null = null;
      let assistantEnglishTranslation: string | null = null;
      let reply = voiceFallback(languageCode).content;
      assistantEnglishTranslation = voiceFallback(languageCode).english;
      let intakeComplete = false;
      try {
        const turn = await evaluateConversationTurn(history, content);
        languageCode = turn.detectedLanguageCode;
        englishTranslation = turn.englishTranslation;
        reply = turn.reply;
        assistantEnglishTranslation = turn.replyEnglishTranslation;
        intakeComplete = turn.intakeComplete;
      } catch {
        // Keep voice available with a short fallback if the model is unavailable.
      }
      await tx.update(conversationMessages).set({ languageCode, contentEnglish: englishTranslation }).where(eq(conversationMessages.id, patientMessage.id));
      await tx.insert(conversationMessages).values({
          conversationId: voiceSession.conversationId,
          replyToMessageId: patientMessage.id,
          role: "assistant",
          modality: "voice",
          languageCode,
          content: reply,
          contentEnglish: assistantEnglishTranslation,
        });
      const nextStatus = intakeComplete ? "closed" as const : "active" as const;
      await tx.update(conversations).set({ languageCode, status: nextStatus, updatedAt: new Date() }).where(eq(conversations.id, voiceSession.conversationId));
      return {
        kind: "complete" as const,
        content: reply,
        messageId: patientMessage.id,
        statement: content,
        languageCode,
      };
    });
    if (result.kind === "unavailable") return response(Boolean(body.data.stream), "");
    if (result.kind === "complete" && result.messageId) {
      const { messageId, statement, languageCode } = result;
      after(() => classifyAndStoreTurn({
        messageId,
        conversationId: voiceSession.conversationId,
        text: statement,
        languageCode,
      }));
      after(() => refreshConversationTitle(voiceSession.conversationId).catch(() => {}));
    }
    return response(Boolean(body.data.stream), result.content);
  } catch {
    // Return one safe turn instead of asking Vapi to retry and potentially spend another model request.
    return response(Boolean(body.data.stream), defaultVoiceFallback);
  }
}
