"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type CareReport = {
  symptoms: string[];
  possibleConditions: Array<{ condition: string; confidencePercent: number; confidenceLabel: string; reasoning: string }>;
  recommendedTests: string[];
  medicalHistory: string[];
  familyHistory: string[];
  patientConcern: string | null;
  nextSteps: string[];
};

type SoapNote = { subjective: string; objective: string; assessment: string; plan: string };
type ReportData = {
  report: CareReport;
  generatedAt: string;
  patientName: string;
  conversationTitle: string | null;
  severity: string;
  departmentName: string | null;
  referenceId: string;
};
type Props = { conversationId: string; triageSummary: string | null; conversationFinished: boolean };
type State = { kind: "loading" } | { kind: "ready"; data: ReportData } | { kind: "empty" | "error"; message: string };

const emptyCopy: Record<keyof CareReport, string> = {
  symptoms: "No symptoms were reported in this conversation.",
  possibleConditions: "Not enough information to suggest possible conditions.",
  recommendedTests: "No tests were suggested from this conversation.",
  medicalHistory: "No medical history was reported.",
  familyHistory: "No family history was reported.",
  patientConcern: "No additional question was recorded.",
  nextSteps: "Speak with a doctor about these symptoms.",
};

function ReportSection({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_3px_12px_rgba(18,36,48,0.06)] print:break-inside-avoid">
    <h2 className={`mb-4 text-lg font-bold ${color}`}>{title}</h2>{children}
  </section>;
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? <ul className="space-y-2 pl-5 text-sm leading-6 text-slate-700">{items.map((item, index) => <li key={`${index}-${item}`} className="list-disc">{item}</li>)}</ul> : <p className="text-sm leading-6 text-slate-500">{empty}</p>;
}

export function CareSummaryPanel({ conversationId, triageSummary, conversationFinished }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const loadReport = async () => {
      setState({ kind: "loading" });
      try {
        const response = await fetch(`/api/patient/conversations/${conversationId}/report?format=json`, { cache: "no-store" });
        const payload = await response.json() as Partial<ReportData> & { error?: string };
        if (cancelled) return;
        if (!response.ok || !payload.report || !payload.generatedAt) {
          if (conversationFinished && response.status === 409 && attempts++ < 30) {
            timer = setTimeout(loadReport, 1000);
            return;
          }
          setState({ kind: response.status === 404 || response.status === 409 ? "empty" : "error", message: conversationFinished ? payload.error || "The summary is not ready yet." : "Your English summary will be prepared when the intake is complete." });
          return;
        }
        setState({ kind: "ready", data: payload as ReportData });
      } catch {
        if (!cancelled) setState({ kind: "error", message: "The summary could not be loaded. Check your connection and try again." });
      }
    };
    void loadReport();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [conversationId, conversationFinished, triageSummary]);

  async function exportPdf() {
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch(`/api/patient/conversations/${conversationId}/report`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "The PDF could not be downloaded.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `health-bridge-summary-${conversationId.slice(0, 8)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "The PDF could not be downloaded.");
    } finally {
      setExporting(false);
    }
  }

  if (state.kind === "loading") return <div className="flex flex-1 items-center justify-center p-8"><p role="status" className="text-sm text-muted-foreground">Preparing your summary automatically…</p></div>;
  if (state.kind !== "ready") return <div className="flex flex-1 items-center justify-center p-6"><div className="w-full max-w-lg rounded-2xl border bg-muted/30 p-5 text-sm"><p className="font-semibold">{state.kind === "empty" ? "Summary not ready yet" : "Summary unavailable"}</p><p className="mt-2 leading-6 text-muted-foreground">{state.message}</p></div></div>;

  const { report, generatedAt, patientName, conversationTitle, severity, departmentName, referenceId } = state.data;
  const symptoms = report.symptoms.length ? report.symptoms : [emptyCopy.symptoms];
  const conditions = report.possibleConditions;
  const englishSummary = triageSummary && !/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u0DFF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/u.test(triageSummary)
    ? triageSummary
    : symptoms.slice(0, 2).join(" ");
  return <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">
    <article className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm sm:p-8 print:max-w-none print:border-0 print:p-0 print:shadow-none">
      <header className="border-l-4 border-blue-600 pl-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Health-Bridge · Care summary</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">Patient Overview: <span className="font-semibold">{patientName}</span></h1></div>
          <div className="text-right text-xs leading-5 text-slate-500"><p>{conversationTitle || "Care conversation"}</p><p>{new Date(generatedAt).toLocaleString()}</p></div>
        </div>
        <p className="mt-4 text-sm leading-6"><strong>Summary:</strong> {englishSummary}</p>
        <p className="mt-2 text-sm"><strong>Suggested specialty:</strong> {departmentName || "Not determined"} <span className="mx-2 text-slate-300">·</span> <strong>Urgency:</strong> {severity}</p>
        <ul className="mt-3 space-y-1.5 pl-5 text-sm leading-6">{symptoms.map((symptom, i) => <li key={`${i}-${symptom}`} className="list-disc">{symptom}</li>)}</ul>
      </header>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <ReportSection title="Symptoms" color="text-rose-700"><Bullets items={report.symptoms} empty={emptyCopy.symptoms} /></ReportSection>
        <ReportSection title="Assessment" color="text-blue-700"><p className="mb-3 text-xs italic text-rose-700">Recommendation only · unverified AI impression</p>{conditions.length ? <div className="space-y-3">{conditions.map((condition) => <div key={condition.condition} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0"><div className="flex items-start justify-between gap-3"><p className="font-semibold">{condition.condition}</p><span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">{condition.confidencePercent}%</span></div><p className="mt-1 text-sm leading-5 text-slate-600">{condition.reasoning}</p></div>)}</div> : <p className="text-sm text-slate-500">{emptyCopy.possibleConditions}</p>}</ReportSection>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <ReportSection title="Recommended Tests" color="text-blue-700"><Bullets items={report.recommendedTests} empty={emptyCopy.recommendedTests} /></ReportSection>
        <ReportSection title="Medical History" color="text-blue-700"><Bullets items={report.medicalHistory} empty={emptyCopy.medicalHistory} /></ReportSection>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <ReportSection title="Family History" color="text-blue-700"><Bullets items={report.familyHistory} empty={emptyCopy.familyHistory} /></ReportSection>
        <ReportSection title="Patient Concerns & Questions" color="text-blue-700"><p className="border-l-4 border-rose-200 pl-4 text-sm leading-6 text-slate-700">{report.patientConcern || emptyCopy.patientConcern}</p></ReportSection>
      </div>
      <div className="mt-4"><ReportSection title="Next Steps" color="text-blue-700"><Bullets items={report.nextSteps} empty={emptyCopy.nextSteps} /></ReportSection></div>
      <p className="mt-5 text-xs leading-5 text-slate-500">This AI generated intake summary is not a diagnosis or a medical record. A qualified clinician should confirm all findings, tests, and next steps. Reference: {referenceId}.</p>
    </article>
    {exportError && <p className="mx-auto mt-3 max-w-5xl text-sm text-destructive" role="alert">{exportError}</p>}
    <div className="mx-auto flex max-w-5xl justify-end pb-2 pt-4"><Button type="button" onClick={() => void exportPdf()} disabled={exporting}>{exporting ? "Exporting…" : "Export PDF"}</Button></div>
  </div>;
}

export function SoapNotePreview({ soap }: { soap: SoapNote | null }) {
  const [copied, setCopied] = useState(false);
  if (!soap) return <div className="mx-auto mt-4 max-w-5xl rounded-2xl border bg-card p-5 text-sm text-muted-foreground">The pre-visit SOAP note is not available yet.</div>;
  const note = `Pre-Visit SOAP Note\n\nSubjective:\n${soap.subjective}\n\nObjective:\n${soap.objective}\n\nAssessment:\n${soap.assessment}\n\nPlan:\n${soap.plan}`;
  async function copyNote() {
    await navigator.clipboard.writeText(note);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return <section className="mx-auto mt-4 max-w-5xl rounded-2xl border bg-white p-5 text-slate-900 shadow-sm sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Clinician handoff</p><h2 className="mt-1 text-xl font-bold">SOAP Note</h2><p className="mt-1 text-xs text-slate-500">Pre-visit note · last edited from this conversation</p></div><Button type="button" variant="outline" size="sm" onClick={() => void copyNote()}>{copied ? "Copied" : "Copy Note"}</Button></div>
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5"><p className="font-semibold">Pre-Visit SOAP Note:</p>{(["subjective", "objective", "assessment", "plan"] as const).map((key) => <div key={key} className="mt-4"><h3 className="font-semibold capitalize">{key}:</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{soap[key] || "Not provided in the conversation."}</p></div>)}</div>
  </section>;
}
