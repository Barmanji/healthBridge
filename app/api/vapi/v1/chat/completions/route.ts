import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { evaluateConversationTurn, type ConversationContextMessage } from "@/lib/ai/conversation-turn";
import { classifyAndStoreTurn } from "@/lib/ml/store";
import { refreshConversationTitle } from "@/lib/conversations/title-store";
import { db } from "@/lib/db";
import {
  auditLogs,
  conversationMessages,
  conversations,
  patientProfiles,
  riskEvents,
  voiceSessions,
} from "@/lib/db/schema";

export const runtime = "nodejs";
export const maxDuration = 20;

const maxBodyBytes = 32 * 1024;
const turnsPerMinute = 5;
const emergencyReply = "This conversation has stopped for safety. Contact local emergency services or someone you trust now if you may be in immediate danger.\n\nयह बातचीत सुरक्षा के लिए रोक दी गई है। अगर आपको तत्काल खतरा हो सकता है, तो अभी स्थानीय आपातकालीन सेवा या किसी भरोसेमंद व्यक्ति से संपर्क करें। इस ऐप का इंतज़ार न करें।";

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
      const [owner] = await tx.select({ userId: patientProfiles.userId, patientId: patientProfiles.id })
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
        return { kind: "complete" as const, content: reply?.content ?? emergencyReply };
      }
      if (locked.status !== "active") return { kind: "complete" as const, content: emergencyReply };

      const [recentCount] = await tx.select({ value: sql<number>`count(*)::int` })
        .from(conversationMessages)
        .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
        .where(and(
          eq(conversations.patientId, owner.patientId),
          eq(conversationMessages.role, "patient"),
          gt(conversationMessages.createdAt, new Date(Date.now() - 60_000)),
        ));
      const overLimit = (recentCount?.value ?? 0) >= turnsPerMinute;

      const historyRows = await tx.select({ role: conversationMessages.role, content: conversationMessages.content })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, voiceSession.conversationId))
        .orderBy(desc(conversationMessages.createdAt))
        .limit(8);
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

      let assessment: "not_critical" | "critical" | "needs_human_review" = "needs_human_review";
      let flags = [overLimit ? "turn_limit_reached" : "risk_check_unavailable"];
      let languageCode = locked.languageCode;
      let englishTranslation: string | null = null;
      let reply = emergencyReply;
      let triggeredBy = "fail_safe";
      if (!overLimit) {
        try {
          const turn = await evaluateConversationTurn(history, content);
          assessment = turn.riskAssessment;
          flags = turn.riskFlags;
          languageCode = turn.detectedLanguageCode;
          englishTranslation = turn.englishTranslation;
          triggeredBy = "openai";
          reply = assessment === "not_critical" ? turn.reply : emergencyReply;
        } catch {
          // A missing key, timeout, provider error, or malformed model reply becomes a HALT response.
        }
      }

      const halted = assessment !== "not_critical";
      const [riskEvent] = await tx.insert(riskEvents).values({
        conversationId: voiceSession.conversationId,
        messageId: patientMessage.id,
        assessment,
        triggeredBy,
        flags,
        actionTaken: halted ? "halted_and_mock_escalation_recorded" : "conversation_continued",
      }).returning({ id: riskEvents.id });
      await tx.update(conversationMessages).set({ languageCode, contentEnglish: englishTranslation }).where(eq(conversationMessages.id, patientMessage.id));
      await tx.insert(conversationMessages).values({
        conversationId: voiceSession.conversationId,
        replyToMessageId: patientMessage.id,
        role: "assistant",
        modality: "voice",
        languageCode,
        content: reply,
      });
      await tx.update(conversations).set({ languageCode, status: halted ? "halted" : "active", updatedAt: new Date() }).where(eq(conversations.id, voiceSession.conversationId));
      if (halted) await tx.insert(auditLogs).values({
        actorUserId: owner.userId,
        action: "conversation.halted",
        entity: "risk_event",
        entityId: riskEvent.id,
        meta: { assessment, escalation: "mock_only", modality: "voice" },
      });
      return {
        kind: "complete" as const,
        content: reply,
        halted,
        messageId: patientMessage.id,
        statement: content,
        languageCode,
      };
    });
    if (result.kind === "unavailable") return response(Boolean(body.data.stream), emergencyReply);
    // Classification is scheduled only for non-halted turns and never blocks the reply:
    // an emergency must not wait on an experimental model.
    if (result.kind === "complete" && !result.halted && result.messageId) {
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
    return response(Boolean(body.data.stream), emergencyReply);
  }
}
