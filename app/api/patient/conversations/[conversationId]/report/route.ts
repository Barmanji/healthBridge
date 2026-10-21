import { and, asc, eq, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { createCareReport, type CareReport } from "@/lib/ai/care-report";
import { db } from "@/lib/db";
import {
  auditLogs,
  conversationMessages,
  conversations,
  departments,
  patientProfiles,
  triageAssessments,
  user,
} from "@/lib/db/schema";
import { renderCareReportPdf } from "@/lib/reports/care-report-pdf";

export const runtime = "nodejs";
export const maxDuration = 30;

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

async function getOwnedReport(request: Request, conversationId: string) {
  if (!isSameOrigin(request)) return { response: Response.json({ error: "Request origin could not be verified." }, { status: 403 }) };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { response: Response.json({ error: "Sign in to view this summary." }, { status: 401 }) };
  if (session.user.role !== "patient") return { response: Response.json({ error: "Patient access is required." }, { status: 403 }) };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
    return { response: Response.json({ error: "Conversation not found." }, { status: 404 }) };
  }

  const [owned] = await db.select({
    triageId: triageAssessments.id,
    severity: triageAssessments.severity,
    report: triageAssessments.careReport,
    departmentName: departments.name,
    title: conversations.title,
    generatedAt: triageAssessments.careReportGeneratedAt,
    createdAt: triageAssessments.createdAt,
    patientName: user.name,
  }).from(triageAssessments)
    .innerJoin(conversations, eq(conversations.id, triageAssessments.conversationId))
    .innerJoin(patientProfiles, eq(patientProfiles.id, conversations.patientId))
    .innerJoin(user, eq(user.id, patientProfiles.userId))
    .leftJoin(departments, eq(departments.id, triageAssessments.departmentId))
    .where(and(eq(triageAssessments.conversationId, conversationId), eq(patientProfiles.userId, session.user.id)))
    .limit(1);

  return owned ? { owned, userId: session.user.id } : { response: Response.json({ error: "This conversation does not have a summary yet." }, { status: 404 }) };
}

async function ensureReport(conversationId: string, owned: NonNullable<Awaited<ReturnType<typeof getOwnedReport>>["owned"]>, userId: string) {
  const cachedReport = owned.report as CareReport | null;
  const cachedText = cachedReport ? JSON.stringify(cachedReport) : "";
  const containsNonEnglishScript = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u0DFF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/u.test(cachedText);
  if (cachedReport && !containsNonEnglishScript) return { report: cachedReport, generatedAt: owned.generatedAt ?? owned.createdAt };
  const messages = await db.select({ role: conversationMessages.role, content: conversationMessages.content, contentEnglish: conversationMessages.contentEnglish })
    .from(conversationMessages)
    .where(and(eq(conversationMessages.conversationId, conversationId), ne(conversationMessages.role, "system")))
    .orderBy(asc(conversationMessages.createdAt))
    .limit(40);
  const transcript = messages.filter((message): message is typeof message & { role: "patient" | "assistant" } => message.role === "patient" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.contentEnglish?.trim() || message.content }));
  if (!transcript.some((message) => message.role === "patient")) throw new Error("NO_PATIENT_MESSAGES");

  const report = await createCareReport(transcript);
  const generatedAt = new Date();
  await db.update(triageAssessments).set({ careReport: report, careReportGeneratedAt: generatedAt }).where(eq(triageAssessments.id, owned.triageId));
  await db.insert(auditLogs).values({
    actorUserId: userId,
    action: "care_report_generated",
    entity: "triage_assessment",
    entityId: owned.triageId,
    meta: { severity: owned.severity, sectionCount: report.symptoms.length + report.recommendedTests.length },
  });
  return { report, generatedAt };
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  try {
    const access = await getOwnedReport(request, conversationId);
    if ("response" in access) return access.response;
    const result = await ensureReport(conversationId, access.owned, access.userId);
    return Response.json({
      report: result.report,
      generatedAt: result.generatedAt.toISOString(),
      patientName: access.owned.patientName,
      conversationTitle: access.owned.title,
      severity: access.owned.severity,
      departmentName: access.owned.departmentName,
      referenceId: access.owned.triageId.slice(0, 8).toUpperCase(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_PATIENT_MESSAGES") {
      return Response.json({ error: "Share a concern in the conversation before viewing a summary." }, { status: 409 });
    }
    return Response.json({ error: "We could not prepare this summary. Please try again later." }, { status: 503 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  try {
    const access = await getOwnedReport(request, conversationId);
    if ("response" in access) return access.response;
    if (!access.owned.report) return Response.json({ error: "The summary is not ready to export yet." }, { status: 409 });
    const ensured = await ensureReport(conversationId, access.owned, access.userId);
    if (new URL(request.url).searchParams.get("format") === "json") {
      return Response.json({
        report: ensured.report,
        generatedAt: ensured.generatedAt.toISOString(),
        patientName: access.owned.patientName,
        conversationTitle: access.owned.title,
        severity: access.owned.severity,
        departmentName: access.owned.departmentName,
        referenceId: access.owned.triageId.slice(0, 8).toUpperCase(),
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const pdf = await renderCareReportPdf(ensured.report, {
      patientName: access.owned.patientName,
      conversationTitle: access.owned.title,
      generatedAt: ensured.generatedAt,
      severity: access.owned.severity,
      departmentName: access.owned.departmentName,
      referenceId: access.owned.triageId.slice(0, 8).toUpperCase(),
    });
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="health-bridge-summary-${access.owned.triageId.slice(0, 8)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "We could not export this summary. Please try again later." }, { status: 503 });
  }
}
