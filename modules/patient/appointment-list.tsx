"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export type PatientAppointmentItem = {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  consultMode: "video" | "audio";
  doctorName: string;
  department: string | null;
  timeZone: string;
  severity: string | null;
  summary: string | null;
  conversationId: string | null;
  section: "upcoming" | "history";
};

export function AppointmentList({ appointments }: { appointments: PatientAppointmentItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  const upcoming = appointments.filter((item) => item.section === "upcoming").sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const history = appointments.filter((item) => item.section === "history").sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  async function cancel(id: string) {
    setPendingId(id);
    setError("");
    try {
      const response = await fetch(`/api/patient/appointments/${id}/cancel`, { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not cancel this appointment.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not cancel this appointment.");
    } finally {
      setPendingId("");
    }
  }

  function group(title: string, entries: PatientAppointmentItem[]) {
    return <section className="space-y-3"><h2 className="text-xl font-semibold">{title}</h2>{entries.length ? entries.map((appointment) => <article key={appointment.id} className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{appointment.doctorName}</h3><p className="mt-1 text-sm text-primary">{appointment.department ?? "Verified clinician"}</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{appointment.status.replaceAll("_", " ")}</span></div>
      <p className="mt-3 text-sm">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: appointment.timeZone }).format(new Date(appointment.startsAt))} · {appointment.consultMode} · Free for now</p>
      {appointment.severity && <p className="mt-2 text-xs text-muted-foreground">Intake priority: {appointment.severity}</p>}
      {appointment.summary && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">AI intake summary</summary><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{appointment.summary}</p></details>}
      {upcoming.includes(appointment) && <div className="mt-4 flex flex-wrap gap-3">{appointment.conversationId && <Link href={`/patient/conversations?id=${appointment.conversationId}`} className="inline-flex min-h-10 items-center text-sm font-semibold text-primary underline">{appointment.status === "confirmed" ? "Reschedule" : "Review care conversation"}</Link>}<Button size="sm" variant="outline" disabled={pendingId === appointment.id} onClick={() => cancel(appointment.id)}>{pendingId === appointment.id ? "Cancelling…" : "Cancel appointment"}</Button></div>}
    </article>) : <p className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">No {title.toLowerCase()}.</p>}</section>;
  }

  return <div className="space-y-8">{error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}{group("Upcoming", upcoming)}{group("Past and cancelled", history)}<p className="text-xs text-muted-foreground">Consultations are free during this phase. A booking is created only after you confirm a held time.</p></div>;
}
