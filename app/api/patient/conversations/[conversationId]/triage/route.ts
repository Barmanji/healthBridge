import { and, desc, eq, ne, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { createTriageSummary } from "@/lib/ai/triage";
import { db } from "@/lib/db";
import { auditLogs, conversationMessages, conversations, departments, patientProfiles, riskEvents, triageAssessments } from "@/lib/db/schema";
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
      const [conversation] = await tx.select({ id: conversations.id, patientId: conversations.patientId, languageCode: conversations.languageCode, status: conversations.status })
        .from(conversations)
        .innerJoin(patientProfiles, eq(patientProfiles.id, conversations.patientId))
        .where(and(eq(conversations.id, conversationId), eq(patientProfiles.userId, session.user.id)))
        .limit(1);
      if (!conversation) return { kind: "not-found" as const };

      const [existing] = await tx.select().from(triageAssessments)
        .where(eq(triageAssessments.conversationId, conversationId)).limit(1);
      if (existing) return { kind: "ready" as const, triage: existing };
      if (conversation.status === "halted") return { kind: "halted" as const };

      const [unsafeRisk] = await tx.select({ id: riskEvents.id }).from(riskEvents)
        .where(and(eq(riskEvents.conversationId, conversationId), ne(riskEvents.assessment, "not_critical"))).limit(1);
      if (unsafeRisk) return { kind: "halted" as const };

      const messages = await tx.select({ role: conversationMessages.role, content: conversationMessages.content })
        .from(conversationMessages)
        .where(and(eq(conversationMessages.conversationId, conversationId), ne(conversationMessages.role, "system")))
        .orderBy(desc(conversationMessages.createdAt)).limit(12);
      const transcript = messages.reverse().filter((message): message is typeof message & { role: "patient" | "assistant" } => message.role === "patient" || message.role === "assistant");
      if (!transcript.some((message) => message.role === "patient")) return { kind: "empty" as const };

      const departmentOptions = await tx.select({ id: departments.id, name: departments.name, slug: departments.slug }).from(departments);
      const summary = await createTriageSummary(transcript, departmentOptions, conversation.languageCode);
      const selectedDepartment = departmentOptions.find((department) => department.slug === summary.departmentSlug);
      const isEmergency = summary.severity === "emergency";
      const [triage] = await tx.insert(triageAssessments).values({
        patientId: conversation.patientId,
        conversationId,
        departmentId: isEmergency ? null : selectedDepartment?.id ?? null,
        languageCode: summary.languageCode,
        summary: summary.summary,
        severity: summary.severity,
        soap: summary.soap,
      }).returning();

      if (isEmergency) {
        const [riskEvent] = await tx.insert(riskEvents).values({
          conversationId,
          assessment: "needs_human_review",
          triggeredBy: "openai_triage",
          flags: ["triage_emergency_severity"],
          actionTaken: "halted_no_appointment_suggested",
        }).returning({ id: riskEvents.id });
        await tx.update(conversations).set({ status: "halted", updatedAt: new Date() }).where(eq(conversations.id, conversationId));
        await tx.insert(auditLogs).values({
          actorUserId: session.user.id,
          action: "triage_emergency_halt",
          entity: "risk_event",
          entityId: riskEvent.id,
          meta: { severity: "emergency", escalation: "mock_only" },
        });
      }

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
    if (result.kind === "halted") return Response.json({ error: "This conversation stopped for safety. No appointment can be suggested." }, { status: 409 });
    if (result.kind === "empty") return Response.json({ error: "Share a concern in the conversation before preparing a care summary." }, { status: 409 });
    const triage = result.triage;
    const suggestions = triage.severity === "emergency" ? [] : await findDoctorSuggestions({ departmentId: triage.departmentId, languageCode: triage.languageCode });
    return Response.json({ triage, suggestions, requiresEmergencyHelp: triage.severity === "emergency" });
  } catch {
    // Do not log or return patient messages, SOAP text, provider errors, or other health details.
    return Response.json({ error: "We could not safely prepare this care summary. Please try again later." }, { status: 503 });
  }
}
