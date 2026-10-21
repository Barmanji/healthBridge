import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversationMessages, conversations } from "@/lib/db/schema";
import { generateConversationTitle } from "@/lib/ai/conversation-title";

/**
 * Refresh a conversation's sidebar title after a completed turn.
 *
 * Runs after the response is sent and is entirely non-essential: any failure is
 * swallowed so a title problem can never affect intake. A conversation the
 * patient renamed is never overwritten.
 */
export async function refreshConversationTitle(conversationId: string): Promise<void> {
  const [conversation] = await db.select({
    titleSource: conversations.titleSource,
  }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation || conversation.titleSource === "patient") return;

  const messages = await db.select({
    role: conversationMessages.role,
    content: conversationMessages.content,
  }).from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(conversationMessages.createdAt)
    .limit(6);

  const usable = messages
    .filter((message) => message.role === "patient" || message.role === "assistant")
    .map((message) => ({ role: message.role as "patient" | "assistant", content: message.content }));
  if (!usable.some((message) => message.role === "patient")) return;

  // A failure here must never leave the thread labelled "New conversation", so
  // pick a stable neutral name instead of returning an empty title.
  const genericTitles = ["Health check-in", "Care conversation", "Health question", "Symptom check-in", "Care check-in"];
  let title: string;
  try {
    title = await generateConversationTitle(usable);
  } catch {
    let hash = 0;
    for (const character of conversationId) hash = (hash * 31 + character.charCodeAt(0)) % 997;
    title = genericTitles[hash % genericTitles.length];
  }
  if (!title.trim()) title = genericTitles[0];

  // Guard the write with the same condition: a rename that lands while the model
  // call is in flight must still win.
  await db.update(conversations)
    .set({ title, titleUpdatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.titleSource, "auto")));
}
