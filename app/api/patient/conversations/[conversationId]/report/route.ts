import { and, asc, eq, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { createCareReport } from "@/lib/ai/care-report";
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

/**
 * Generate (once) and download the patient's care report as a PDF.
 *
 * The report is persisted on the triage assessment, so a later download rebuilds
 * the identical document from stored sections instead of asking the model again.
 * That is what keeps the layout and the content stable across presses.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  if (!isSameOrigin(request))
    return Response.json(
      { error: "Request origin could not be verified." },
      { status: 403 },
    );
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "Sign in to download this summary." },
      { status: 401 },
    );
  if (session.user.role !== "patient")
    return Response.json(
      { error: "Patient access is required." },
      { status: 403 },
    );

  const { conversationId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      conversationId,
    )
  ) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  try {
    const [owned] = await db
      .select({
        triageId: triageAssessments.id,
        severity: triageAssessments.severity,
        report: triageAssessments.careReport,
        departmentName: departments.name,
        title: conversations.title,
        generatedAt: triageAssessments.careReportGeneratedAt,
        createdAt: triageAssessments.createdAt,
        patientName: user.name,
      })
      .from(triageAssessments)
      .innerJoin(
        conversations,
        eq(conversations.id, triageAssessments.conversationId),
      )
      .innerJoin(
        patientProfiles,
        eq(patientProfiles.id, conversations.patientId),
      )
      .innerJoin(user, eq(user.id, patientProfiles.userId))
      .leftJoin(departments, eq(departments.id, triageAssessments.departmentId))
      .where(
        and(
          eq(triageAssessments.conversationId, conversationId),
          eq(patientProfiles.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!owned)
      return Response.json(
        { error: "Prepare a care summary before downloading it." },
        { status: 404 },
      );

    let report = owned.report;
    let generatedAt = owned.generatedAt;

    if (!report) {
      const messages = await db
        .select({
          role: conversationMessages.role,
          content: conversationMessages.content,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversationId),
            ne(conversationMessages.role, "system"),
          ),
        )
        .orderBy(asc(conversationMessages.createdAt))
        .limit(40);
      const transcript = messages.filter(
        (
          message,
        ): message is typeof message & { role: "patient" | "assistant" } =>
          message.role === "patient" || message.role === "assistant",
      );
      if (!transcript.some((message) => message.role === "patient")) {
        return Response.json(
          {
            error:
              "Share a concern in the conversation before downloading a summary.",
          },
          { status: 409 },
        );
      }

      report = await createCareReport(transcript);
      generatedAt = new Date();
      await db
        .update(triageAssessments)
        .set({ careReport: report, careReportGeneratedAt: generatedAt })
        .where(eq(triageAssessments.id, owned.triageId));
      await db.insert(auditLogs).values({
        actorUserId: session.user.id,
        action: "care_report_generated",
        entity: "triage_assessment",
        entityId: owned.triageId,
        meta: {
          severity: owned.severity,
          sectionCount: report.symptoms.length + report.recommendedTests.length,
        },
      });
    }

    const pdf = await renderCareReportPdf(report, {
      patientName: owned.patientName,
      conversationTitle: owned.title,
      generatedAt: generatedAt ?? owned.createdAt,
      severity: owned.severity,
      departmentName: owned.departmentName,
      referenceId: owned.triageId.slice(0, 8).toUpperCase(),
    });

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="health-bridge-summary-${owned.triageId.slice(0, 8)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    // Never log or return patient messages, report sections, or provider errors.
    return Response.json(
      { error: "We could not prepare this summary. Please try again later." },
      { status: 503 },
    );
  }
}
