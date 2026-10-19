import "server-only";
import { z } from "zod";

/**
 * Server-side adapter for the local statement classifier (see ML.md §4).
 *
 * Design rules, all deliberate:
 * - **Fail open.** If the service is down, slow, or returns junk, classification is
 *   skipped. Intake, triage, and the emergency HALT path must never depend on this.
 * - **Never blocking.** The HTTP timeout is short and the caller invokes this after the
 *   conversation turn has already been committed.
 * - **No PII in logs.** Statement text is never logged or echoed into an error message.
 * - **Not a safety signal.** The returned category is a documentation label. It is not
 *   used for risk assessment, severity, routing, or any emergency decision.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:8000";

/** Kept well under the conversation route's budget so a slow service cannot stall intake. */
const REQUEST_TIMEOUT_MS = 1200;

const MAX_STATEMENT_CHARS = 1800;

export const STATEMENT_CATEGORIES = [
  "symptom",
  "duration",
  "medication",
  "allergy",
  "medical_history",
  "other",
] as const;

export type StatementCategory = (typeof STATEMENT_CATEGORIES)[number];

const predictionSchema = z.object({
  category: z.enum(STATEMENT_CATEGORIES),
  modelVersion: z.string().min(1).max(120),
  confidence: z.number().min(0).max(1),
  uncertain: z.boolean(),
});

export type StatementPrediction = {
  statement: string;
  category: StatementCategory;
  confidence: number;
  uncertain: boolean;
  modelVersion: string;
};

function serviceBaseUrl() {
  const configured = process.env.ML_SERVICE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return DEFAULT_BASE_URL;
}

export function mlServiceConfigured() {
  // The local service has a working default, so classification is on unless disabled.
  return process.env.ML_CLASSIFIER_DISABLED !== "true";
}

/**
 * Split a turn into short statements so each can be classified independently.
 *
 * ML.md §2 documents this limitation: a statement that spans two categories is split
 * first, and each part is labelled on its own rather than predicting multiple labels.
 * Devanagari uses `।` as its full stop, so that character is treated as a boundary too.
 */
export function splitStatements(text: string, maxStatements = 6): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const parts = normalized
    .split(/(?<=[.!?।])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
  const statements = (parts.length ? parts : [normalized]).slice(0, maxStatements);
  return statements.map((statement) => statement.slice(0, MAX_STATEMENT_CHARS));
}

/**
 * Classify one statement. Returns `null` instead of throwing when the service is
 * unavailable, so the caller can simply carry on without a classification.
 */
export async function classifyStatement(
  statement: string,
  languageCode?: string | null,
): Promise<StatementPrediction | null> {
  const trimmed = statement.trim();
  if (!trimmed || trimmed.length > MAX_STATEMENT_CHARS) return null;
  if (!mlServiceConfigured()) return null;

  try {
    const response = await fetch(`${serviceBaseUrl()}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        text: trimmed,
        ...(languageCode ? { language: languageCode } : {}),
      }),
    });
    if (!response.ok) return null;
    const parsed = predictionSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    return {
      statement: trimmed,
      category: parsed.data.category,
      confidence: parsed.data.confidence,
      uncertain: parsed.data.uncertain,
      modelVersion: parsed.data.modelVersion,
    };
  } catch {
    // Offline, timed out, refused, or malformed. Classification is optional by design.
    return null;
  }
}

/**
 * Classify a whole turn. Returns an empty array when the service is unavailable so the
 * caller stores nothing rather than inventing a category.
 */
export async function classifyTurn(
  text: string,
  languageCode?: string | null,
): Promise<StatementPrediction[]> {
  const statements = splitStatements(text);
  if (!statements.length) return [];
  const settled = await Promise.all(
    statements.map((statement) => classifyStatement(statement, languageCode)),
  );
  return settled.filter((prediction): prediction is StatementPrediction => prediction !== null);
}
