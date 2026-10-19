import { and, desc, eq, gt, sql } from "drizzle-orm";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { evaluateConversationTurn, type ConversationContextMessage } from "@/lib/ai/conversation-turn";
import { classifyAndStoreTurn } from "@/lib/ml/store";
import { db } from "@/lib/db";
import {
  auditLogs,
  conversationMessages,
  conversations,
  patientProfiles,
  riskEvents,
} from "@/lib/db/schema";
import { conversationMessageSchema } from "@/modules/patient/schemas";

export const runtime = "nodejs";
export const maxDuration = 20;

const fallbackMessage = "We could not safely review this message, so this chat has stopped. If you may be in immediate danger, contact local emergency services or someone you trust now.\n\nहम इस संदेश की सुरक्षित जाँच नहीं कर पाए, इसलिए यह चैट रोक दी गई है। अगर आपको तत्काल खतरा हो सकता है, तो अभी स्थानीय आपातकालीन सेवा या किसी भरोसेमंद व्यक्ति से संपर्क करें।";
const maxBodyBytes = 12 * 1024;
const turnsPerMinute = 5;

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

      const [existing] = await tx.select({ id: conversationMessages.id, content: conversationMessages.content, contentEnglish: conversationMessages.contentEnglish, languageCode: conversationMessages.languageCode, createdAt: conversationMessages.createdAt })
        .from(conversationMessages)
        .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.clientMessageId, parsed.data.clientMessageId)))
        .limit(1);
      if (existing) {
        const [assistant] = await tx.select({ id: conversationMessages.id, content: conversationMessages.content, languageCode: conversationMessages.languageCode, createdAt: conversationMessages.createdAt })
          .from(conversationMessages)
          .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.replyToMessageId, existing.id)))
          .limit(1);
        return { kind: "duplicate" as const, patientMessage: existing, assistantMessage: assistant ?? null, status: ownedConversation.status };
      }
      if (ownedConversation.status !== "active") return { kind: "halted" as const };

      const [recentCount] = await tx.select({ value: sql<number>`count(*)::int` })
        .from(conversationMessages)
        .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
        .where(and(
          eq(conversations.patientId, ownedConversation.patientId),
          eq(conversationMessages.role, "patient"),
          gt(conversationMessages.createdAt, new Date(Date.now() - 60_000)),
        ));
      const overLimit = (recentCount?.value ?? 0) >= turnsPerMinute;

      const historyRows = await tx.select({ role: conversationMessages.role, content: conversationMessages.content })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversationId))
        .orderBy(desc(conversationMessages.createdAt))
        .limit(8);
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
      }).returning({ id: conversationMessages.id, content: conversationMessages.content, contentEnglish: conversationMessages.contentEnglish, languageCode: conversationMessages.languageCode, createdAt: conversationMessages.createdAt });

      let assessment: "not_critical" | "critical" | "needs_human_review" = "needs_human_review";
      let riskFlags = [overLimit ? "turn_limit_reached" : "risk_check_unavailable"];
      let languageCode = parsed.data.languageCode;
      let englishTranslation: string | null = null;
      let assistantText = fallbackMessage;
      let triggeredBy = "fail_safe";
      let turnSucceeded = false;
      if (!overLimit) {
        try {
          // The model combines language detection, translation, risk review, and the reply in this one call.
          const turn = await evaluateConversationTurn(context, parsed.data.content);
          assessment = turn.riskAssessment;
          riskFlags = turn.riskFlags;
          languageCode = turn.detectedLanguageCode;
          englishTranslation = turn.englishTranslation;
          triggeredBy = "openai";
          turnSucceeded = true;
          assistantText = turn.reply;
        } catch {
          // No retry: a timeout, missing key, provider failure, or invalid output is always fail-closed.
        }
      }

      const halted = assessment !== "not_critical";
      const actionTaken = halted ? "halted_and_mock_escalation_recorded" : "conversation_continued";
      const [riskEvent] = await tx.insert(riskEvents).values({
        conversationId,
        messageId: patientMessage.id,
        assessment,
        triggeredBy: turnSucceeded ? triggeredBy : "fail_safe",
        flags: riskFlags,
        actionTaken,
      }).returning({ id: riskEvents.id });
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
        contentEnglish: null,
      }).returning({ id: conversationMessages.id, content: conversationMessages.content, languageCode: conversationMessages.languageCode, createdAt: conversationMessages.createdAt });

      await tx.update(conversations).set({ languageCode, status: halted ? "halted" : "active", updatedAt: new Date() }).where(eq(conversations.id, conversationId));
      if (halted) {
        await tx.insert(auditLogs).values({
          actorUserId: session.user.id,
          action: "conversation.halted",
          entity: "risk_event",
          entityId: riskEvent.id,
          meta: { assessment, escalation: "mock_only" },
        });
      }
      return { kind: "processed" as const, patientMessage, assistantMessage, status: halted ? "halted" as const : "active" as const, assessment, riskEventId: riskEvent.id, languageCode };
    });

    if (result.kind === "not-found") return Response.json({ error: "Conversation not found." }, { status: 404 });
    if (result.kind === "halted") return Response.json({ error: "This conversation has stopped for safety. Start a new conversation if you need help." }, { status: 409 });

    // The turn is already committed. Classification runs after the response is sent and
    // cannot affect the risk assessment, the reply, or the HALT decision. Halted turns are
    // skipped: an emergency must never wait on an experimental model, however briefly.
    if (result.kind === "processed" && result.status === "active") {
      const messageId = result.patientMessage.id;
      const text = result.patientMessage.content;
      const languageCode = result.languageCode;
      after(() => classifyAndStoreTurn({ messageId, conversationId, text, languageCode }));
    }

    return Response.json(result, { status: 200 });
  } catch {
    // Provider/database details and health information are intentionally not returned or logged.
    return Response.json({ error: "We could not safely process this message. Please contact a trusted person or local healthcare service." }, { status: 503 });
  }
}
