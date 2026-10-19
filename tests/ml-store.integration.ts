import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversationMessages, conversations, patientProfiles, statementClassifications, user } from "@/lib/db/schema";
import { classifyAndStoreTurn } from "@/lib/ml/store";

/**
 * Live persistence check for `lib/ml/store.ts`.
 *
 * Needs Postgres up and the classifier service running. Creates a throwaway patient and
 * conversation, writes classifications, then deletes everything it created.
 *
 *   docker compose up -d health-bridge-pg
 *   ml/.venv/bin/uvicorn api:app --app-dir ml --host 127.0.0.1 --port 8000 &
 *   pnpm vitest run --config vitest.live.config.ts tests/ml-store.integration.ts
 */
describe("classifyAndStoreTurn", () => {
  let userId: string;
  let conversationId: string;
  let messageId: string;

  beforeAll(async () => {
    userId = `test-ml-${Date.now()}`;
    await db.insert(user).values({
      id: userId,
      name: "ML Test Patient",
      email: `${userId}@example.invalid`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [profile] = await db.insert(patientProfiles)
      .values({ userId, preferredLanguage: "en" }).returning({ id: patientProfiles.id });
    const [conversation] = await db.insert(conversations)
      .values({ patientId: profile!.id, aiProcessingConsentAt: new Date() })
      .returning({ id: conversations.id });
    conversationId = conversation!.id;
    const [message] = await db.insert(conversationMessages)
      .values({ conversationId, role: "patient", content: "I have a headache", modality: "text" })
      .returning({ id: conversationMessages.id });
    messageId = message!.id;
  });

  afterAll(async () => {
    // Cascades remove the profile, conversation, messages, and classifications.
    if (userId) await db.delete(user).where(eq(user.id, userId));
  });

  it("stores one row per statement with the original text verbatim", async () => {
    await classifyAndStoreTurn({
      messageId,
      conversationId,
      text: "I have a headache. It started two days ago.",
      languageCode: "en",
    });

    const rows = await db.select().from(statementClassifications)
      .where(eq(statementClassifications.messageId, messageId))
      .orderBy(statementClassifications.statementIndex);

    expect(rows).toHaveLength(2);
    expect(rows[0]!.statement).toBe("I have a headache.");
    expect(rows[0]!.predictedCategory).toBe("symptom");
    expect(rows[0]!.modelVersion).toBe("statement-classifier-lr-v1");
    expect(rows[1]!.statement).toBe("It started two days ago.");
    expect(rows[1]!.predictedCategory).toBe("duration");
    expect(rows[0]!.languageCode).toBe("en");
    expect(rows[0]!.correctedCategory).toBeNull();
  });

  it("is idempotent when the same turn is stored twice", async () => {
    await classifyAndStoreTurn({
      messageId,
      conversationId,
      text: "I have a headache. It started two days ago.",
      languageCode: "en",
    });
    const rows = await db.select().from(statementClassifications)
      .where(eq(statementClassifications.messageId, messageId));
    expect(rows).toHaveLength(2);
  });

  it("stores nothing and does not throw when the service is unreachable", async () => {
    const [message] = await db.insert(conversationMessages)
      .values({ conversationId, role: "patient", content: "unreachable case", modality: "text" })
      .returning({ id: conversationMessages.id });

    const original = process.env.ML_SERVICE_URL;
    process.env.ML_SERVICE_URL = "http://127.0.0.1:9";
    try {
      await expect(classifyAndStoreTurn({
        messageId: message!.id,
        conversationId,
        text: "I have a cough.",
      })).resolves.toBeUndefined();
    } finally {
      process.env.ML_SERVICE_URL = original;
    }

    const rows = await db.select().from(statementClassifications)
      .where(eq(statementClassifications.messageId, message!.id));
    expect(rows).toHaveLength(0);
  });
});
