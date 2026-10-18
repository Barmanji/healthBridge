import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversationMessages, conversations, patientProfiles } from "@/lib/db/schema";
import { ConversationWorkspace } from "@/modules/patient/conversation-workspace";

export default async function PatientConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; new?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "patient") redirect("/sign-in");
  const [{ id: requestedId, new: newConversation }, profileRows] = await Promise.all([
    searchParams,
    db.select({ id: patientProfiles.id }).from(patientProfiles)
      .where(eq(patientProfiles.userId, session.user.id)).limit(1),
  ]);
  const profile = profileRows[0];
  if (!profile) redirect("/patient/onboarding");

  const threads = await db.select({
    id: conversations.id,
    languageCode: conversations.languageCode,
    status: conversations.status,
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
  return <ConversationWorkspace
    key={`${selectedThread?.id ?? "new-conversation"}:${selectedThread?.status ?? "none"}:${allMessages.at(-1)?.id ?? "empty"}`}
    currentId={selectedThread?.id ?? null}
    currentStatus={selectedThread?.status ?? null}
    voiceEnabled={Boolean(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY && process.env.VAPI_ASSISTANT_ID)}
    initialMessages={allMessages.map((message) => ({ ...message, createdAt: message.createdAt.toISOString() }))}
    threads={threads.map((thread) => ({ ...thread, createdAt: thread.createdAt.toISOString() }))}
  />;
}
