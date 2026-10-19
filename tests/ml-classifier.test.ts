import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the ML adapter (ML.md §7).
 *
 * These deliberately exercise the *failure* paths: the classifier is an experimental
 * aid, so the one thing that must always hold is that intake keeps working when the
 * service is missing, slow, or returning nonsense.
 */

const ORIGINAL_ENV = { ...process.env };

async function loadAdapter() {
  // Re-import per test so `process.env` changes are picked up by the module.
  vi.resetModules();
  return import("@/lib/ml/classifier");
}

describe("splitStatements", () => {
  it("splits on sentence boundaries", async () => {
    const { splitStatements } = await loadAdapter();
    expect(splitStatements("I have a headache. It started two days ago.")).toEqual([
      "I have a headache.",
      "It started two days ago.",
    ]);
  });

  it("treats the Devanagari danda as a sentence boundary", async () => {
    const { splitStatements } = await loadAdapter();
    expect(splitStatements("मुझे सिरदर्द है। मुझे बुखार है।")).toEqual([
      "मुझे सिरदर्द है।",
      "मुझे बुखार है।",
    ]);
  });

  it("keeps a single sentence as one statement", async () => {
    const { splitStatements } = await loadAdapter();
    expect(splitStatements("Mujhe teen din se bukhar hai.")).toEqual(["Mujhe teen din se bukhar hai."]);
  });

  it("drops fragments too short to be worth classifying", async () => {
    const { splitStatements } = await loadAdapter();
    // The minimum statement length is 3 characters, so "ok." survives but "hi" does not.
    expect(splitStatements("I have a cough. ok. It started today.")).toEqual([
      "I have a cough.",
      "ok.",
      "It started today.",
    ]);
    expect(splitStatements("I have a cough. hi")).toEqual(["I have a cough."]);
  });

  it("caps the number of statements per turn", async () => {
    const { splitStatements } = await loadAdapter();
    const long = Array.from({ length: 20 }, (_, index) => `Statement number ${index}.`).join(" ");
    expect(splitStatements(long, 6)).toHaveLength(6);
  });

  it("returns nothing for blank input rather than inventing a statement", async () => {
    const { splitStatements } = await loadAdapter();
    expect(splitStatements("   ")).toEqual([]);
    expect(splitStatements("")).toEqual([]);
  });
});

describe("classifyStatement", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.ML_CLASSIFIER_DISABLED;
    delete process.env.ML_SERVICE_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns the parsed prediction from a healthy service", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      category: "symptom",
      modelVersion: "statement-classifier-lr-v1",
      confidence: 0.93,
      uncertain: false,
    }), { status: 200 })));
    const { classifyStatement } = await loadAdapter();
    const result = await classifyStatement("I have a headache.");
    expect(result).toEqual({
      statement: "I have a headache.",
      category: "symptom",
      confidence: 0.93,
      uncertain: false,
      modelVersion: "statement-classifier-lr-v1",
    });
  });

  it("fails open when the service refuses the connection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const { classifyStatement } = await loadAdapter();
    await expect(classifyStatement("I have a headache.")).resolves.toBeNull();
  });

  it("fails open when the service times out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }));
    const { classifyStatement } = await loadAdapter();
    await expect(classifyStatement("I have a headache.")).resolves.toBeNull();
  });

  it("fails open on a non-ok response instead of parsing it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 500 })));
    const { classifyStatement } = await loadAdapter();
    await expect(classifyStatement("I have a headache.")).resolves.toBeNull();
  });

  it("rejects a category outside the documentation label set", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      category: "emergency",
      modelVersion: "v1",
      confidence: 0.99,
      uncertain: false,
    }), { status: 200 })));
    const { classifyStatement } = await loadAdapter();
    await expect(classifyStatement("I have chest pain.")).resolves.toBeNull();
  });

  it("rejects a confidence outside the 0..1 range", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      category: "symptom",
      modelVersion: "v1",
      confidence: 4.2,
      uncertain: false,
    }), { status: 200 })));
    const { classifyStatement } = await loadAdapter();
    await expect(classifyStatement("I have a fever.")).resolves.toBeNull();
  });

  it("does not call the service when classification is disabled", async () => {
    process.env.ML_CLASSIFIER_DISABLED = "true";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { classifyStatement } = await loadAdapter();
    await expect(classifyStatement("I have a fever.")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not call the service for blank or oversized statements", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { classifyStatement } = await loadAdapter();
    await expect(classifyStatement("   ")).resolves.toBeNull();
    await expect(classifyStatement("pain ".repeat(600))).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses ML_SERVICE_URL when set and strips a trailing slash", async () => {
    process.env.ML_SERVICE_URL = "http://127.0.0.1:9001/";
    const fetchSpy = vi.fn<(input: string | URL | Request) => Promise<Response>>(
      async () => new Response(JSON.stringify({
        category: "other", modelVersion: "v1", confidence: 0.5, uncertain: true,
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { classifyStatement } = await loadAdapter();
    await classifyStatement("Just so you know, I work nights.");
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://127.0.0.1:9001/predict");
  });

  it("never throws, whatever the service does", async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw "not even an Error"; }));
    const { classifyStatement } = await loadAdapter();
    await expect(classifyStatement("I have a cough.")).resolves.toBeNull();
  });
});

describe("classifyTurn", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.ML_CLASSIFIER_DISABLED;
    delete process.env.ML_SERVICE_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("classifies every statement in the turn independently", async () => {
    const responses = ["symptom", "duration"];
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      category: responses[call++],
      modelVersion: "v1",
      confidence: 0.8,
      uncertain: false,
    }), { status: 200 })));
    const { classifyTurn } = await loadAdapter();
    const result = await classifyTurn("I have a headache. It started two days ago.");
    expect(result.map((row) => row.category)).toEqual(["symptom", "duration"]);
    expect(result.map((row) => row.statement)).toEqual([
      "I have a headache.",
      "It started two days ago.",
    ]);
  });

  it("returns an empty list when the service is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const { classifyTurn } = await loadAdapter();
    await expect(classifyTurn("I have a headache.")).resolves.toEqual([]);
  });

  it("keeps the statements that succeeded when one call fails", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error("ECONNREFUSED");
      return new Response(JSON.stringify({
        category: "duration", modelVersion: "v1", confidence: 0.7, uncertain: false,
      }), { status: 200 });
    }));
    const { classifyTurn } = await loadAdapter();
    const result = await classifyTurn("I have a headache. It started two days ago.");
    expect(result).toHaveLength(1);
    expect(result[0]?.category).toBe("duration");
  });
});

describe("safety invariants", () => {
  it("exposes exactly the documentation categories and nothing else", async () => {
    const { STATEMENT_CATEGORIES } = await loadAdapter();
    expect([...STATEMENT_CATEGORIES]).toEqual([
      "symptom", "duration", "medication", "allergy", "medical_history", "other",
    ]);
  });

  it("does not import the risk, triage, or HALT modules", async () => {
    // The doc comment legitimately *describes* the HALT path, so this asserts on real
    // imports and calls rather than prose: no module from the safety path may be pulled in.
    const source = await import("node:fs/promises")
      .then((fs) => fs.readFile("lib/ml/classifier.ts", "utf8"));
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      "@/lib/ai/triage",
      "@/lib/ai/conversation-turn",
      "@/lib/db/schema",
      "riskEvents",
      "triageAssessments",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("never writes statement text into a log or error message", async () => {
    const source = await import("node:fs/promises")
      .then((fs) => fs.readFile("lib/ml/classifier.ts", "utf8"));
    expect(source).not.toMatch(/console\.(log|warn|error|info)/);
    expect(source).not.toMatch(/throw new Error\([^)]*text/);
  });
});
