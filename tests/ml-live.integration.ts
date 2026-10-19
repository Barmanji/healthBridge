import { describe, expect, it } from "vitest";
import { classifyStatement, classifyTurn, splitStatements } from "@/lib/ml/classifier";

/**
 * Live integration check against a running classifier service.
 *
 * Excluded from `pnpm test` (which must pass without any service). Run it explicitly:
 *   ml/.venv/bin/uvicorn api:app --app-dir ml --host 127.0.0.1 --port 8000 &
 *   pnpm vitest run tests/ml-live.integration.ts --config vitest.live.config.ts
 */
const CASES: Array<[string, string]> = [
  ["I have a headache since yesterday.", "symptom"],
  ["It started three days ago.", "duration"],
  ["I take insulin every morning.", "medication"],
  ["I am allergic to penicillin.", "allergy"],
  ["मुझे गले में दर्द है।", "symptom"],
  ["Mujhe penicillin se allergy hai.", "allergy"],
];

/**
 * Statements that genuinely span two categories. ML.md §2 says these are split before
 * classification; handed in whole, the service must flag them for review instead of
 * asserting a confident single label. "four months ago" is a real duration cue inside a
 * statement whose main content is personal context, so either answer is defensible.
 */
const AMBIGUOUS_CASES: Array<[string, string[]]> = [
  ["I stopped smoking four months ago.", ["other", "duration"]],
  ["I have had asthma since childhood.", ["medical_history", "duration"]],
];

describe("live classifier service", () => {
  it("is reachable", async () => {
    const result = await classifyStatement("I have a headache.");
    expect(result, "service unreachable — start uvicorn first").not.toBeNull();
  });

  it.each(CASES)("classifies %j as %s", async (text, expected) => {
    const result = await classifyStatement(text);
    expect(result?.category).toBe(expected);
  });

  it.each(AMBIGUOUS_CASES)("flags %j for review instead of asserting a label", async (text, allowed) => {
    const result = await classifyStatement(text);
    expect(allowed).toContain(result?.category);
    expect(result?.uncertain).toBe(true);
  });

  it("labels each statement of a multi-statement turn separately", async () => {
    const turn = await classifyTurn(
      "I have a headache. It started two days ago. I take metformin.",
    );
    expect(turn.map((row) => row.category)).toEqual(["symptom", "duration", "medication"]);
    expect(turn.map((row) => row.statement)).toEqual(splitStatements(
      "I have a headache. It started two days ago. I take metformin.",
    ));
  });

  it("measures the real HTTP round trip", async () => {
    await classifyStatement("warm up");
    const runs = 50;
    const started = performance.now();
    for (let index = 0; index < runs; index += 1) {
      await classifyStatement("I have a mild headache today.");
    }
    const perCall = (performance.now() - started) / runs;
    console.log(`round-trip over local HTTP: ${perCall.toFixed(2)} ms/call (${runs} calls)`);
    expect(perCall).toBeLessThan(200);
  });
});
