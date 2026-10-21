import { and, desc, eq, ne, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { createTriageSummary } from "@/lib/ai/triage";
import { db } from "@/lib/db";
import { auditLogs, conversationMessages, conversations, departments, patientProfiles, triageAssessments } from "@/lib/db/schema";
import { findDoctorSuggestions } from "@/modules/patient/matching";

export const runtime = "nodejs";
export const maxDuration = 20;

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
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

  try {
    const result = await db.transaction(async (tx) => {
      // A single lock per conversation prevents duplicate concurrent model calls.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.user.id}))`);
      const [conversation] = await tx.select({ id: conversations.id, patientId: conversations.patientId, languageCode: conversations.languageCode })
        .from(conversations)
        .innerJoin(patientProfiles, eq(patientProfiles.id, conversations.patientId))
        .where(and(eq(conversations.id, conversationId), eq(patientProfiles.userId, session.user.id)))
        .limit(1);
      if (!conversation) return { kind: "not-found" as const };

      const [existing] = await tx.select().from(triageAssessments)
        .where(eq(triageAssessments.conversationId, conversationId)).limit(1);
      if (existing) {
        const cachedText = JSON.stringify({ summary: existing.summary, soap: existing.soap });
        const containsNonEnglishScript = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u0DFF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/u.test(cachedText);
        if (!containsNonEnglishScript) return { kind: "ready" as const, triage: existing };

        const messages = await tx.select({ role: conversationMessages.role, content: conversationMessages.content, contentEnglish: conversationMessages.contentEnglish })
          .from(conversationMessages)
          .where(and(eq(conversationMessages.conversationId, conversationId), ne(conversationMessages.role, "system")))
          .orderBy(desc(conversationMessages.createdAt)).limit(12);
        const transcript = messages.reverse().filter((message): message is typeof message & { role: "patient" | "assistant" } => message.role === "patient" || message.role === "assistant")
          .map((message) => ({ role: message.role, content: message.contentEnglish?.trim() || message.content }));
        const departmentOptions = await tx.select({ id: departments.id, name: departments.name, slug: departments.slug }).from(departments);
        const translated = await createTriageSummary(transcript, departmentOptions, existing.languageCode);
        const [updated] = await tx.update(triageAssessments).set({ summary: translated.summary, soap: translated.soap })
          .where(eq(triageAssessments.id, existing.id)).returning();
        return { kind: "ready" as const, triage: updated ?? existing };
      }

      const messages = await tx.select({ role: conversationMessages.role, content: conversationMessages.content, contentEnglish: conversationMessages.contentEnglish })
        .from(conversationMessages)
        .where(and(eq(conversationMessages.conversationId, conversationId), ne(conversationMessages.role, "system")))
        .orderBy(desc(conversationMessages.createdAt)).limit(12);
      const transcript = messages.reverse().filter((message): message is typeof message & { role: "patient" | "assistant" } => message.role === "patient" || message.role === "assistant")
        .map((message) => ({ role: message.role, content: message.contentEnglish?.trim() || message.content }));
      if (!transcript.some((message) => message.role === "patient")) return { kind: "empty" as const };

      const departmentOptions = await tx.select({ id: departments.id, name: departments.name, slug: departments.slug }).from(departments);
      const summary = await createTriageSummary(transcript, departmentOptions, conversation.languageCode);
      const selectedDepartment = departmentOptions.find((department) => department.slug === summary.departmentSlug);
      const [triage] = await tx.insert(triageAssessments).values({
        patientId: conversation.patientId,
        conversationId,
        departmentId: selectedDepartment?.id ?? null,
        languageCode: summary.languageCode,
        summary: summary.summary,
        severity: summary.severity,
        soap: summary.soap,
      }).returning();

      await tx.insert(auditLogs).values({
        actorUserId: session.user.id,
        action: "triage_summary_created",
        entity: "triage_assessment",
        entityId: triage.id,
        meta: { severity: triage.severity, departmentId: triage.departmentId },
      });
      return { kind: "ready" as const, triage };
    });

    if (result.kind === "not-found") return Response.json({ error: "Conversation not found." }, { status: 404 });
    if (result.kind === "empty") return Response.json({ error: "Share a concern in the conversation before preparing a care summary." }, { status: 409 });
    const triage = result.triage;
    const suggestions = await findDoctorSuggestions({ departmentId: triage.departmentId, languageCode: triage.languageCode });
    return Response.json({ triage, suggestions });
  } catch {
    // Do not log or return patient messages, SOAP text, provider errors, or other health details.
    return Response.json({ error: "We could not safely prepare this care summary. Please try again later." }, { status: 503 });
  }
}
