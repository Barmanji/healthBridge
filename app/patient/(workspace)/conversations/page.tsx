import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appointments, conversationMessages, conversations, doctorProfiles, patientProfiles, triageAssessments } from "@/lib/db/schema";
import { ConversationWorkspace } from "@/modules/patient/conversation-workspace";
import { findDoctorSuggestions } from "@/modules/patient/matching";

export default async function PatientConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; new?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "patient") redirect("/sign-in");
  const [{ id: requestedId, new: newConversation }, profileRows] = await Promise.all([
    searchParams,
    db.select({ id: patientProfiles.id, preferredLanguage: patientProfiles.preferredLanguage }).from(patientProfiles)
      .where(eq(patientProfiles.userId, session.user.id)).limit(1),
  ]);
  const profile = profileRows[0];
  if (!profile) redirect("/patient/onboarding");

  const threads = await db.select({
    id: conversations.id,
    languageCode: conversations.languageCode,
    status: conversations.status,
    title: conversations.title,
    createdAt: conversations.createdAt,
  }).from(conversations)
    .where(eq(conversations.patientId, profile.id))
    .orderBy(desc(conversations.createdAt))
    .limit(30);

  const selectedThread = newConversation === "1" ? undefined : (requestedId && /^[0-9a-f-]{36}$/i.test(requestedId)
    ? threads.find((thread) => thread.id === requestedId)
    : undefined) ?? threads[0];
  const allMessages = selectedThread ? await db.select({
    id: conversationMessages.id,
    role: conversationMessages.role,
    modality: conversationMessages.modality,
    content: conversationMessages.content,
    contentEnglish: conversationMessages.contentEnglish,
    languageCode: conversationMessages.languageCode,
    createdAt: conversationMessages.createdAt,
  }).from(conversationMessages)
    .where(eq(conversationMessages.conversationId, selectedThread.id))
    .orderBy(conversationMessages.createdAt)
    .limit(100) : [];
  const [triage] = selectedThread ? await db.select({
    id: triageAssessments.id,
    summary: triageAssessments.summary,
    severity: triageAssessments.severity,
    languageCode: triageAssessments.languageCode,
    departmentId: triageAssessments.departmentId,
  }).from(triageAssessments).where(eq(triageAssessments.conversationId, selectedThread.id)).limit(1) : [];
  const appointmentRows = triage ? await db.select({
    id: appointments.id,
    status: appointments.status,
    startsAt: appointments.startsAt,
    endsAt: appointments.endsAt,
    holdExpiresAt: appointments.holdExpiresAt,
    consultMode: appointments.consultMode,
    timeZone: doctorProfiles.timeZone,
  }).from(appointments).innerJoin(doctorProfiles, eq(doctorProfiles.id, appointments.doctorId))
    .where(eq(appointments.triageId, triage.id)).orderBy(desc(appointments.createdAt)).limit(10) : [];
  const savedAppointment = appointmentRows.find((item) => item.status === "confirmed")
    ?? appointmentRows.find((item) => item.status === "held")
    ?? appointmentRows[0];
  const doctorSuggestions = triage && triage.severity !== "emergency"
    ? await findDoctorSuggestions({ departmentId: triage.departmentId, languageCode: triage.languageCode })
    : [];
  return <ConversationWorkspace
    key={`${selectedThread?.id ?? "new-conversation"}:${selectedThread?.status ?? "none"}:${allMessages.at(-1)?.id ?? "empty"}`}
    currentId={selectedThread?.id ?? null}
    currentStatus={selectedThread?.status ?? null}
    currentTitle={selectedThread?.title ?? null}
    voiceEnabled={Boolean(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY && process.env.VAPI_ASSISTANT_ID)}
    preferredLanguage={profile.preferredLanguage}
    triage={triage ? { id: triage.id, summary: triage.summary, severity: triage.severity, languageCode: triage.languageCode } : null}
    doctorSuggestions={doctorSuggestions}
    appointment={savedAppointment ? { ...savedAppointment, status: savedAppointment.status === "held" && savedAppointment.holdExpiresAt && savedAppointment.holdExpiresAt <= new Date() ? "expired" : savedAppointment.status, startsAt: savedAppointment.startsAt.toISOString(), endsAt: savedAppointment.endsAt.toISOString(), holdExpiresAt: savedAppointment.holdExpiresAt?.toISOString() ?? null } : null}
    initialMessages={allMessages.map((message) => ({ ...message, createdAt: message.createdAt.toISOString() }))}
    threads={threads.map((thread) => ({ ...thread, createdAt: thread.createdAt.toISOString() }))}
  />;
}
