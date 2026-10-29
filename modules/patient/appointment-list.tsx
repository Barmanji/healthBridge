"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type PatientAppointmentItem = {
  id: string;
  status: string;
  holdExpiresAt: string | null;
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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasHeldAppointment = appointments.some((item) => item.status === "held");

  useEffect(() => {
    if (!hasHeldAppointment) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasHeldAppointment]);

  const upcoming = appointments.filter((item) => item.section === "upcoming").sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const history = appointments.filter((item) => item.section === "history").sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  async function confirm(id: string) {
    setPendingId(id);
    try {
      const response = await fetch(`/api/patient/appointments/${id}/confirm`, { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not confirm this appointment.");
      toast.success("Appointment confirmed");
      router.refresh();
    } catch (reason) {
      toast.error("Could not confirm appointment", { description: reason instanceof Error ? reason.message : "Try again." });
    } finally {
      setPendingId("");
    }
  }

  async function cancel(id: string) {
    setPendingId(id);
    try {
      const response = await fetch(`/api/patient/appointments/${id}/cancel`, { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not cancel this appointment.");
      toast.success("Appointment cancelled");
      router.refresh();
    } catch (reason) {
      toast.error("Could not cancel appointment", { description: reason instanceof Error ? reason.message : "Try again." });
    } finally {
      setPendingId("");
    }
  }

  function group(title: string, entries: PatientAppointmentItem[]) {
    return <section className="space-y-3"><h2 className="text-xl font-semibold">{title}</h2>{entries.length ? entries.map((appointment) => {
      const secondsLeft = appointment.holdExpiresAt ? Math.max(0, Math.ceil((Date.parse(appointment.holdExpiresAt) - nowMs) / 1000)) : 0;
      const heldLive = appointment.status === "held" && secondsLeft > 0;
      const expired = appointment.status === "expired" || (appointment.status === "held" && !heldLive);
      return <article key={appointment.id} className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{appointment.doctorName}</h3><p className="mt-1 text-sm text-primary">{appointment.department ?? "Verified clinician"}</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{appointment.status.replaceAll("_", " ")}</span></div>
        <p className="mt-3 text-sm">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: appointment.timeZone }).format(new Date(appointment.startsAt))} · {appointment.consultMode} · Free for now</p>
        {appointment.severity && <p className="mt-2 text-xs text-muted-foreground">Intake priority: {appointment.severity}</p>}
        {appointment.summary && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">AI intake summary</summary><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{appointment.summary}</p></details>}
        {heldLive && <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4"><p className="font-medium">This time is held for you · {secondsLeft}s left</p><p className="mt-1 text-xs text-muted-foreground">It is not booked until you confirm. Your doctor will not see this visit until then.</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={pendingId === appointment.id} onClick={() => confirm(appointment.id)}>{pendingId === appointment.id ? "Confirming…" : "Confirm appointment"}</Button><Button size="sm" variant="outline" disabled={pendingId === appointment.id} onClick={() => cancel(appointment.id)}>Cancel</Button></div></div>}
        {expired && <p className="mt-4 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">This time was held but never confirmed, so no appointment was booked.{appointment.conversationId && <> <Link href={`/patient/conversations?id=${appointment.conversationId}`} className="font-semibold text-primary underline">Choose another time</Link>.</>}</p>}
        {appointment.status === "confirmed" && appointment.section === "upcoming" && <div className="mt-4 flex flex-wrap gap-3">{appointment.conversationId && <Link href={`/patient/conversations?id=${appointment.conversationId}`} className="inline-flex min-h-10 items-center text-sm font-semibold text-primary underline">Reschedule</Link>}<Button size="sm" variant="outline" disabled={pendingId === appointment.id} onClick={() => cancel(appointment.id)}>{pendingId === appointment.id ? "Cancelling…" : "Cancel appointment"}</Button></div>}
      </article>;
    }) : <p className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">No {title.toLowerCase()}.</p>}</section>;
  }

  return <div className="space-y-8">{group("Upcoming", upcoming)}{group("Past and cancelled", history)}<p className="text-xs text-muted-foreground">Consultations are free during this phase. A booking is created only after you confirm a held time.</p></div>;
}
