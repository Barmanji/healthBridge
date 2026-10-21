"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { DoctorSuggestion } from "@/modules/patient/matching";

type TriageView = { id: string; summary: string; severity: "routine" | "soon" | "urgent" | "emergency"; languageCode: string };
type AppointmentView = { id: string; status: string; startsAt: string; endsAt: string; holdExpiresAt: string | null; consultMode: "video" | "audio"; timeZone?: string };

export function AppointmentProposal({
  initialTriage,
  initialSuggestions,
  conversationId,
  requiresEmergencyHelp = false,
  initialAppointment = null,
}: {
  initialTriage: TriageView | null;
  initialSuggestions: DoctorSuggestion[];
  conversationId: string;
  requiresEmergencyHelp?: boolean;
  initialAppointment?: AppointmentView | null;
}) {
  const router = useRouter();
  const [triage, setTriage] = useState(initialTriage);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [appointment, setAppointment] = useState(initialAppointment);
  const [previousAppointment, setPreviousAppointment] = useState<AppointmentView | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [remaining, setRemaining] = useState(initialAppointment?.status === "held" ? 60 : 0);
  const [pending, setPending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (appointment?.status !== "held" || !appointment.holdExpiresAt) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(appointment.holdExpiresAt!) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [appointment]);

  async function prepareSummary() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/patient/conversations/${conversationId}/triage`, { method: "POST" });
      const payload = await response.json() as { triage?: TriageView; suggestions?: DoctorSuggestion[]; requiresEmergencyHelp?: boolean; error?: string };
      if (!response.ok || !payload.triage) throw new Error(payload.error || "Could not prepare the care summary.");
      setTriage(payload.triage);
      setSuggestions(payload.suggestions ?? []);
      if (payload.requiresEmergencyHelp) setError("This summary indicates a possible emergency. Do not wait for an appointment. Contact local emergency services or someone you trust now. अगर तत्काल खतरा हो सकता है, तो अभी स्थानीय आपातकालीन सेवा या किसी भरोसेमंद व्यक्ति से संपर्क करें।");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare the care summary.");
    } finally {
      setPending(false);
    }
  }

  async function downloadReport() {
    if (!triage || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const response = await fetch(`/api/patient/conversations/${conversationId}/report`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "The PDF could not be downloaded.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `health-bridge-summary-${triage.id.slice(0, 8)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The PDF could not be downloaded.");
    } finally {
      setDownloading(false);
    }
  }

  async function holdSlot(doctorId: string, startsAt: string, consultMode: "video" | "audio") {
    if (!triage || pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/patient/appointments/holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId, triageId: triage.id, startsAt, consultMode }),
      });
      const payload = await response.json() as { appointment?: AppointmentView; timeZone?: string; error?: string };
      if (!response.ok || !payload.appointment) throw new Error(payload.error || "Could not hold that time.");
      setAppointment({ ...payload.appointment, timeZone: payload.timeZone });
      setRemaining(60);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not hold that time.");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function confirmAppointment() {
    if (!appointment || remaining <= 0 || pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/patient/appointments/${appointment.id}/confirm`, { method: "POST" });
      const payload = await response.json() as { status?: string; error?: string };
      if (!response.ok || payload.status !== "confirmed") throw new Error(payload.error || "Could not confirm this appointment.");
      setAppointment({ ...appointment, status: "confirmed", holdExpiresAt: null });
      setPreviousAppointment(null);
      setRescheduling(false);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not confirm this appointment.");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const emergency = requiresEmergencyHelp || triage?.severity === "emergency";
  if (emergency) return <section role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5">
    <h2 className="font-semibold text-destructive">Please seek urgent help now</h2>
    <p className="mt-2 text-sm leading-6">This chat is not an emergency service. Contact local emergency services or someone you trust now. अगर तत्काल खतरा हो सकता है, तो अभी स्थानीय आपातकालीन सेवा या किसी भरोसेमंद व्यक्ति से संपर्क करें।</p>
  </section>;

  if (!triage) return <section className="rounded-2xl border bg-card p-5">
    <p className="text-sm text-muted-foreground">When you are ready, prepare one clinician handoff and see available verified doctors. This uses one bounded AI request; it does not book automatically.</p>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <Button className="mt-4" onClick={prepareSummary} disabled={pending}>{pending ? "Preparing…" : "Prepare care summary"}</Button>
  </section>;

  const displayDate = (value: string, timeZone: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
  return <section className="space-y-4 rounded-2xl border bg-card p-5" aria-label="Triage and doctor suggestions">
    <div><p className="text-sm font-semibold text-primary">Care summary · {triage.severity}</p><p className="mt-2 text-sm leading-6">{triage.summary}</p><p className="mt-2 text-xs text-muted-foreground">This is an AI-generated handoff for a clinician, not a diagnosis or treatment plan.</p><div className="mt-4 flex flex-wrap items-center gap-2"><Button onClick={downloadReport} disabled={downloading}>{downloading ? "Preparing PDF…" : "Download summary as PDF"}</Button></div></div>
    {appointment?.status === "confirmed" && <div role="status" className="rounded-xl bg-primary/10 p-4"><p className="font-semibold">Appointment confirmed</p><p className="mt-1 text-sm">{displayDate(appointment.startsAt, appointment.timeZone ?? "Asia/Kolkata")} · {appointment.consultMode} · Free for now</p><Link href="/patient/appointments" className="mt-2 inline-block text-sm font-semibold underline">View appointments</Link><Button className="mt-3 block" size="sm" variant="outline" onClick={() => { setPreviousAppointment(appointment); setRescheduling(true); setDismissed(false); }}>Find another time</Button></div>}
    {appointment?.status === "held" && remaining > 0 && <div className="rounded-xl border border-primary/30 bg-primary/5 p-4"><p className="font-semibold">Review before booking</p><p className="mt-1 text-sm">{displayDate(appointment.startsAt, appointment.timeZone ?? "Asia/Kolkata")} · {appointment.consultMode} · Free for now</p><p className="mt-1 text-xs text-muted-foreground">This time is held for you for {remaining} seconds. It is not booked until you confirm.</p><Button className="mt-3" onClick={confirmAppointment} disabled={pending}>{pending ? "Confirming…" : "Confirm appointment"}</Button></div>}
    {appointment?.status === "held" && remaining <= 0 && <div role="status" className="rounded-xl bg-muted/50 p-3 text-sm"><p>The one-minute hold expired. Choose another available time.</p>{previousAppointment && <Button className="mt-2" size="sm" variant="outline" onClick={() => { setAppointment(previousAppointment); setPreviousAppointment(null); setRescheduling(false); }}>Keep my current appointment</Button>}</div>}
    {(!appointment || ["expired", "cancelled", "declined"].includes(appointment.status) || (appointment.status === "held" && remaining <= 0) || rescheduling) && !dismissed && <>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Verified doctor options</h3><Button variant="ghost" size="sm" onClick={() => { if (previousAppointment) { setAppointment(previousAppointment); setPreviousAppointment(null); setRescheduling(false); } else setDismissed(true); }}>Not now</Button></div>
      {suggestions.length ? <div className="grid gap-3">{suggestions.map((doctor, index) => <article key={doctor.doctorId} className="rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold">{doctor.name}</h4><p className="mt-1 text-sm text-primary">{doctor.department ?? "Verified doctor"}</p></div><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">Verified</span></div>
        <p className="mt-1 text-xs text-muted-foreground">{[doctor.city, doctor.state].filter(Boolean).join(", ") || "Location not listed"}{doctor.languages.length ? ` · ${doctor.languages.join(", ")}` : ""}</p>
        <p className="mt-2 text-xs">{doctor.why.join(" · ")}</p>
        <ul className="mt-3 space-y-2">{doctor.slots.map((slot) => <li key={slot.startsAt} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-3"><span className="text-sm">{displayDate(slot.startsAt, doctor.timeZone)}</span><span className="flex flex-wrap gap-2">{doctor.consultModes.map((mode) => <Button key={mode} size="sm" variant="outline" disabled={pending} onClick={() => holdSlot(doctor.doctorId, slot.startsAt, mode)}>Choose {mode}</Button>)}</span></li>)}</ul>
        {index === 0 && suggestions.length > 1 && <p className="mt-2 text-xs text-muted-foreground">Other options are listed below. Nothing is booked until you confirm.</p>}
      </article>)}</div> : <div className="rounded-xl bg-muted/50 p-4 text-sm"><p className="font-medium">No doctor is available right now.</p><p className="mt-1 text-muted-foreground">There are no verified doctors with an open slot for this summary. You can still search the full directory, or try again later when more slots open up.</p></div>}
      <Link href="/patient/doctors" className="inline-block text-sm font-semibold text-primary underline">Search all verified doctors</Link>
    </>}
    {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
  </section>;
}
