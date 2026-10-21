import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  renderCareReportPdf,
  type CareReportMeta,
} from "@/lib/reports/care-report-pdf";
import type { CareReport } from "@/lib/ai/care-report";

const fixedMeta: CareReportMeta = {
  patientName: "Test Patient",
  conversationTitle: "Burning when passing urine",
  generatedAt: new Date("2026-10-21T10:00:00Z"),
  severity: "soon",
  departmentName: "General Medicine",
  referenceId: "AB12CD34",
};

const baseReport: CareReport = {
  symptoms: ["Burning when passing urine", "Lower belly discomfort"],
  possibleConditions: [
    {
      condition: "Urinary tract infection",
      confidencePercent: 55,
      confidenceLabel: "moderate",
      reasoning: "Burning with lower abdominal pain.",
    },
  ],
  recommendedTests: ["Urine routine and microscopy"],
  medicalHistory: ["One prior episode"],
  familyHistory: [],
  patientConcern: "Should I see a doctor today?",
  nextSteps: ["See a doctor within a day."],
};

/**
 * Extract drawable text from a PDF. pdf-lib Flate-compresses the content
 * streams, so the raw bytes are unreadable until each stream is inflated.
 */
function pdfText(bytes: Uint8Array) {
  const raw = Buffer.from(bytes);
  const latin = raw.toString("latin1");
  const chunks: string[] = [];
  let position = 0;

  for (;;) {
    const start = latin.indexOf("stream", position);
    if (start === -1) break;
    let dataStart = start + "stream".length;
    if (latin[dataStart] === "\r") dataStart += 1;
    if (latin[dataStart] === "\n") dataStart += 1;
    const end = latin.indexOf("endstream", dataStart);
    if (end === -1) break;
    const slice = raw.subarray(dataStart, end);
    try {
      chunks.push(inflateSync(slice).toString("latin1"));
    } catch {
      chunks.push(slice.toString("latin1"));
    }
    position = end + "endstream".length;
  }

  return chunks
    .join("\n")
    // pdf-lib writes glyphs as hex strings inside <...>; decode them to text.
    .replace(/<([0-9A-Fa-f\s]+)>/g, (_match, hex: string) => {
      const clean = hex.replace(/\s+/g, "");
      const bytes = Buffer.from(clean, "hex");
      return bytes.toString("latin1");
    })
    .replace(/\\([()\\])/g, "$1")
    .replace(/[^\x20-\x7E]/g, " ");
}

describe("renderCareReportPdf", () => {
  it("produces a valid PDF with the A4 page size", async () => {
    const bytes = await renderCareReportPdf(baseReport, fixedMeta);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    // MediaBox for A4 at 72dpi.
    expect(pdfText(bytes)).toContain("595.28");
    expect(pdfText(bytes)).toContain("841.89");
  });

  it("renders the fixed section order with symptoms and assessment side by side", async () => {
    const text = pdfText(await renderCareReportPdf(baseReport, fixedMeta));
    expect(text).toContain("SYMPTOMS");
    expect(text).toContain("ASSESSMENT");
    expect(text).toContain("RECOMMENDED TESTS");
    expect(text).toContain("MEDICAL HISTORY");
    expect(text).toContain("FAMILY HISTORY");
    expect(text).toContain("PATIENT CONCERN OR QUESTION");
    expect(text).toContain("NEXT STEPS");
  });

  it("labels the assessment as an unverified confidence estimate, never a diagnosis", async () => {
    const text = pdfText(await renderCareReportPdf(baseReport, fixedMeta));
    expect(text).toContain("55%");
    expect(text).toContain("moderate confidence");
    expect(text).toContain("unverified");
    expect(text).toContain("not a diagnosis");
  });

  it("omits the patient concern section entirely when the patient raised none", async () => {
    const text = pdfText(
      await renderCareReportPdf({ ...baseReport, patientConcern: null }, fixedMeta),
    );
    expect(text).not.toContain("PATIENT CONCERN");
    expect(text).toContain("NEXT STEPS");
  });

  it("states unknown history as unknown instead of inventing it", async () => {
    const text = pdfText(
      await renderCareReportPdf(
        { ...baseReport, medicalHistory: [], familyHistory: [] },
        fixedMeta,
      ),
    );
    expect(text).toContain("did not report any medical history");
    expect(text).toContain("did not report any family history");
  });

  it("is byte-identical for the same stored report", async () => {
    const a = await renderCareReportPdf(baseReport, fixedMeta);
    const b = await renderCareReportPdf(baseReport, fixedMeta);
    const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
    expect(hash(a)).toBe(hash(b));
  });

  it("never drops patient-reported symptoms when the sections overflow one page", async () => {
    const long =
      "A persistent sensation building over several weeks that interferes with daily activity and sleep. ";
    const report: CareReport = {
      ...baseReport,
      symptoms: Array.from({ length: 12 }, (_, index) => `Symptom ${index + 1}: ${long}`),
    };
    const text = pdfText(await renderCareReportPdf(report, fixedMeta));
    for (let index = 1; index <= 12; index += 1) {
      expect(text).toContain(`Symptom ${index}:`);
    }
  });

  it("renders safely when the report has no conditions, tests, or next steps", async () => {
    const text = pdfText(
      await renderCareReportPdf(
        {
          symptoms: ["Headache"],
          possibleConditions: [],
          recommendedTests: [],
          medicalHistory: [],
          familyHistory: [],
          patientConcern: null,
          nextSteps: [],
        },
        { ...fixedMeta, conversationTitle: null, departmentName: null, severity: "routine" },
      ),
    );
    // The empty-state sentence wraps across two drawn lines, so assert on the
    // fragments rather than the unwrapped sentence.
    expect(text).toContain("Not enough information to suggest any possible");
    expect(text).toContain("condition.");
    expect(text).toContain("Speak with a doctor about these symptoms");
  });

  it("does not throw on characters the built-in fonts cannot encode", async () => {
    const bytes = await renderCareReportPdf(
      {
        ...baseReport,
        symptoms: ["सिरदर्द और बुखार", "তিন দিন ধরে জ্বর", "தலைவலி"],
        patientConcern: "मुझे क्या करना चाहिए?",
      },
      fixedMeta,
    );
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
