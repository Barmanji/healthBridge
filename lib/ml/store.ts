import "server-only";
import { db } from "@/lib/db";
import { statementClassifications } from "@/lib/db/schema";
import { classifyTurn } from "@/lib/ml/classifier";

/**
 * Classify a saved patient turn and store the labels (ML.md §4).
 *
 * Contract:
 * - Called **after** the conversation turn has been committed and the response sent, so
 *   it can never influence the reply or triage.
 * - Stores the original statement verbatim. Nothing is rewritten or discarded.
 * - If the classifier is unavailable, nothing is stored for that turn. The intake flow
 *   is untouched and the doctor UI simply shows no categories.
 * - Never throws: a failure here must not surface as an error to the patient.
 */
export async function classifyAndStoreTurn(input: {
  messageId: string;
  conversationId: string;
  text: string;
  languageCode?: string | null;
}): Promise<void> {
  try {
    const predictions = await classifyTurn(input.text, input.languageCode);
    if (!predictions.length) return;

    await db
      .insert(statementClassifications)
      .values(
        predictions.map((prediction, index) => ({
          messageId: input.messageId,
          statementIndex: index,
          statement: prediction.statement,
          languageCode: input.languageCode ?? null,
          modelVersion: prediction.modelVersion,
          predictedCategory: prediction.category,
          confidence: prediction.confidence,
          status: prediction.uncertain ? ("uncertain" as const) : ("auto" as const),
        })),
      )
      .onConflictDoNothing({
        target: [statementClassifications.messageId, statementClassifications.statementIndex],
      });
  } catch {
    // Classification is an experimental aid; it must never break the intake flow.
  }
}
