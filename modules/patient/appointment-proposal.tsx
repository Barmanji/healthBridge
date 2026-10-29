"use client";

import { useEffect, useState } from "react";
import { TZDate } from "react-day-picker";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DoctorSuggestion } from "@/modules/patient/matching";

type TriageView = { id: string; summary: string; severity: "routine" | "soon" | "urgent" | "emergency"; languageCode: string };
type AppointmentView = { id: string; status: string; startsAt: string; endsAt: string; holdExpiresAt: string | null; consultMode: "video" | "audio"; timeZone?: string };
type BookingSelection = { doctorId: string; doctorName: string; startsAt: string; consultMode: "video" | "audio"; timeZone: string };

export function AppointmentProposal({
  initialTriage,
  initialSuggestions,
  initialAppointment = null,
}: {
  initialTriage: TriageView | null;
  initialSuggestions: DoctorSuggestion[];
  initialAppointment?: AppointmentView | null;
}) {
  const router = useRouter();
  const triage = initialTriage;
  const suggestions = initialSuggestions;
  const [appointment, setAppointment] = useState(initialAppointment);
  const [previousAppointment, setPreviousAppointment] = useState<AppointmentView | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [remaining, setRemaining] = useState(initialAppointment?.status === "held" ? 60 : 0);
  const [pending, setPending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [calendarDoctorId, setCalendarDoctorId] = useState<string | null>(null);
  const [calendarDate, setCalendarDate] = useState<Date | undefined>();
  const [selectedSlotStart, setSelectedSlotStart] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<"video" | "audio">("video");
  const [bookingSelection, setBookingSelection] = useState<BookingSelection | null>(null);
  const [bookingConfirmationOpen, setBookingConfirmationOpen] = useState(false);

  useEffect(() => {
    if (appointment?.status !== "held" || !appointment.holdExpiresAt) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(appointment.holdExpiresAt!) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [appointment]);

  const displayDate = (value: string, timeZone: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
  const dateInZone = (value: Date | string, timeZone: string) => {
    const date = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  };
  const dateForZone = (key: string, timeZone: string) => {
    const [year, month, day] = key.split("-").map(Number);
    return new TZDate(year, month - 1, day, 12, timeZone);
  };
  const timeRange = (startsAt: string, endsAt: string, timeZone: string) => {
    const formatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone });
    return `${formatter.format(new Date(startsAt))} – ${formatter.format(new Date(endsAt))}`;
  };

  function requestBooking(selection: BookingSelection) {
    setBookingSelection(selection);
    setCalendarDoctorId(null);
    setBookingConfirmationOpen(true);
  }

  async function completeBooking(selection: BookingSelection) {
    if (!triage || pending) return;
    setPending(true);
    try {
      const response = await fetch("/api/patient/appointments/holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId: selection.doctorId, triageId: triage.id, startsAt: selection.startsAt, consultMode: selection.consultMode }),
      });
      const payload = await response.json() as { appointment?: AppointmentView; timeZone?: string; error?: string };
      if (!response.ok || !payload.appointment) throw new Error(payload.error || "Could not reserve that time.");
      setAppointment({ ...payload.appointment, timeZone: payload.timeZone });
      setRemaining(60);

      const confirmResponse = await fetch(`/api/patient/appointments/${payload.appointment.id}/confirm`, { method: "POST" });
      const confirmPayload = await confirmResponse.json() as { status?: string; error?: string };
      if (!confirmResponse.ok || confirmPayload.status !== "confirmed") {
        throw new Error(confirmPayload.error || "The time was held but could not be confirmed. Use the confirmation button below.");
      }
      setAppointment({ ...payload.appointment, status: "confirmed", holdExpiresAt: null, timeZone: payload.timeZone });
      setPreviousAppointment(null);
      setRescheduling(false);
      toast.success("Appointment confirmed", { description: `${selection.doctorName} · ${displayDate(selection.startsAt, selection.timeZone)}` });
      router.push("/patient/appointments");
      router.refresh();
    } catch (reason) {
      toast.error("Booking failed", { description: reason instanceof Error ? reason.message : "Could not book that time." });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function confirmAppointment() {
    if (!appointment || remaining <= 0 || pending) return;
    setPending(true);
    try {
      const response = await fetch(`/api/patient/appointments/${appointment.id}/confirm`, { method: "POST" });
      const payload = await response.json() as { status?: string; error?: string };
      if (!response.ok || payload.status !== "confirmed") throw new Error(payload.error || "Could not confirm this appointment.");
      setAppointment({ ...appointment, status: "confirmed", holdExpiresAt: null });
      setPreviousAppointment(null);
      setRescheduling(false);
      toast.success("Appointment confirmed");
      router.push("/patient/appointments");
      router.refresh();
    } catch (reason) {
      toast.error("Could not confirm appointment", { description: reason instanceof Error ? reason.message : "Try again." });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const calendarDoctor = suggestions.find((doctor) => doctor.doctorId === calendarDoctorId) ?? null;
  const availableDateKeys = new Set(calendarDoctor?.slots.map((slot) => dateInZone(slot.startsAt, calendarDoctor.timeZone)) ?? []);
  const selectedDateKey = calendarDoctor && calendarDate ? dateInZone(calendarDate, calendarDoctor.timeZone) : "";
  const selectedDaySlots = calendarDoctor?.slots.filter((slot) => dateInZone(slot.startsAt, calendarDoctor.timeZone) === selectedDateKey) ?? [];
  const selectedSlot = selectedDaySlots.find((slot) => slot.startsAt === selectedSlotStart) ?? null;

  function openCalendar(doctor: DoctorSuggestion) {
    const firstDate = doctor.slots[0] ? dateInZone(doctor.slots[0].startsAt, doctor.timeZone) : "";
    setCalendarDate(firstDate ? dateForZone(firstDate, doctor.timeZone) : undefined);
    setSelectedSlotStart(null);
    setSelectedMode(doctor.consultModes[0] ?? "video");
    setCalendarDoctorId(doctor.doctorId);
  }

  if (!triage) return <section className="rounded-2xl border bg-card p-5">
    <p className="text-sm text-muted-foreground">Your clinician handoff, SOAP note, and doctor suggestions will be prepared automatically when you finish the conversation.</p>
  </section>;

  return <>
    <section className="space-y-4 rounded-2xl border bg-card p-5" aria-label="Triage and doctor suggestions">
      <div><p className="text-sm font-semibold text-primary">Care summary · {triage.severity}</p><p className="mt-2 text-sm leading-6">{triage.summary}</p><p className="mt-2 text-xs text-muted-foreground">This is an AI-generated handoff for a clinician, not a diagnosis or treatment plan.</p></div>
      {appointment?.status === "confirmed" && <div role="status" className="rounded-xl bg-primary/10 p-4"><p className="font-semibold">Appointment confirmed</p><p className="mt-1 text-sm">{displayDate(appointment.startsAt, appointment.timeZone ?? "Asia/Kolkata")} · {appointment.consultMode} · Free for now</p><Link href="/patient/appointments" className="mt-2 inline-block text-sm font-semibold underline">View appointments</Link><Button className="mt-3 block" size="sm" variant="outline" onClick={() => { setPreviousAppointment(appointment); setRescheduling(true); setDismissed(false); }}>Find another time</Button></div>}
      {appointment?.status === "held" && remaining > 0 && <div className="rounded-xl border border-primary/30 bg-primary/5 p-4"><p className="font-semibold">Review before booking</p><p className="mt-1 text-sm">{displayDate(appointment.startsAt, appointment.timeZone ?? "Asia/Kolkata")} · {appointment.consultMode} · Free for now</p><p className="mt-1 text-xs text-muted-foreground">This time is held for you for {remaining} seconds. It is not booked until you confirm.</p><Button className="mt-3" onClick={confirmAppointment} disabled={pending}>{pending ? "Confirming…" : "Confirm appointment"}</Button></div>}
      {appointment?.status === "held" && remaining <= 0 && <div role="status" className="rounded-xl bg-muted/50 p-3 text-sm"><p>The one-minute hold expired. Choose another available time.</p>{previousAppointment && <Button className="mt-2" size="sm" variant="outline" onClick={() => { setAppointment(previousAppointment); setPreviousAppointment(null); setRescheduling(false); }}>Keep my current appointment</Button>}</div>}
      {(!appointment || ["expired", "cancelled", "declined"].includes(appointment.status) || (appointment.status === "held" && remaining <= 0) || rescheduling) && !dismissed && <>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Verified doctor options</h3><Button variant="ghost" size="sm" onClick={() => { if (previousAppointment) { setAppointment(previousAppointment); setPreviousAppointment(null); setRescheduling(false); } else setDismissed(true); }}>Not now</Button></div>
        {suggestions.length ? <div className="grid gap-3">{suggestions.map((doctor, index) => <article key={doctor.doctorId} className="rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold">{doctor.name}</h4><p className="mt-1 text-sm text-primary">{doctor.department ?? "Verified doctor"}</p></div><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">Verified</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{[doctor.city, doctor.state].filter(Boolean).join(", ") || "Location not listed"}{doctor.languages.length ? ` · ${doctor.languages.join(", ")}` : ""}</p>
          <p className="mt-2 text-xs">{doctor.why.join(" · ")}</p>
          <ul className="mt-3 space-y-2">{doctor.slots.slice(0, 3).map((slot) => <li key={slot.startsAt} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-3"><span className="text-sm">{displayDate(slot.startsAt, doctor.timeZone)}</span><span className="flex flex-wrap gap-2">{doctor.consultModes.map((mode) => <Button key={mode} size="sm" variant="outline" disabled={pending} onClick={() => requestBooking({ doctorId: doctor.doctorId, doctorName: doctor.name, startsAt: slot.startsAt, consultMode: mode, timeZone: doctor.timeZone })}>Book {mode}</Button>)}</span></li>)}</ul>
          {doctor.slots.length > 3 && <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => openCalendar(doctor)}>Choose another date or time</Button>}
          {index === 0 && suggestions.length > 1 && <p className="mt-2 text-xs text-muted-foreground">Other options are listed below. You will confirm in a dialog before the appointment is booked.</p>}
        </article>)}</div> : <div className="rounded-xl bg-muted/50 p-4 text-sm"><p className="font-medium">No doctor is available right now.</p><p className="mt-1 text-muted-foreground">There are no verified doctors with an open slot for this summary. You can still search the full directory, or try again later when more slots open up.</p></div>}
        <Link href="/patient/doctors" className="inline-block text-sm font-semibold text-primary underline">Search all verified doctors</Link>
      </>}
    </section>

    <Dialog open={Boolean(calendarDoctor)} onOpenChange={(open) => { if (!open) setCalendarDoctorId(null); }}>
      {calendarDoctor && <DialogContent className="block max-h-[90dvh] overflow-y-auto p-0 sm:max-w-4xl">
        <div className="grid sm:min-h-[510px] sm:grid-cols-[minmax(190px,0.72fr)_1.6fr]">
          <div className="flex flex-col justify-between bg-gradient-to-br from-emerald-700 via-teal-800 to-slate-950 p-6 text-white sm:p-8">
            <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">Appointment booking</p><h2 className="mt-3 font-heading text-2xl font-semibold">Choose a time</h2><p className="mt-3 text-sm leading-6 text-white/75">Pick a date and an available appointment time with {calendarDoctor.name}.</p></div>
            <div className="mt-8 border-t border-white/20 pt-4"><p className="font-semibold">{calendarDoctor.department ?? "Verified doctor"}</p><p className="mt-1 text-xs text-white/70">Times shown in {calendarDoctor.timeZone}</p></div>
          </div>
          <div className="p-5 sm:p-7">
            <DialogHeader className="pr-8"><DialogTitle>Available dates and times</DialogTitle><DialogDescription>Select a date with availability, then choose one of the offered time slots.</DialogDescription></DialogHeader>
            <div className="mt-4 grid gap-5 md:grid-cols-[minmax(230px,0.95fr)_minmax(220px,1fr)]">
              <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Choose a date</p>
                <Calendar
                  mode="single"
                  timeZone={calendarDoctor.timeZone}
                  selected={calendarDate}
                  onSelect={(date) => { setCalendarDate(date); setSelectedSlotStart(null); }}
                  disabled={(day) => !availableDateKeys.has(dateInZone(day, calendarDoctor.timeZone))}
                  startMonth={calendarDoctor.slots[0] ? dateForZone(dateInZone(calendarDoctor.slots[0].startsAt, calendarDoctor.timeZone), calendarDoctor.timeZone) : undefined}
                  endMonth={calendarDoctor.slots.at(-1) ? dateForZone(dateInZone(calendarDoctor.slots.at(-1)!.startsAt, calendarDoctor.timeZone), calendarDoctor.timeZone) : undefined}
                  className="mx-auto p-1 [--cell-size:--spacing(9)]"
                />
              </div>
              <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Available times{calendarDate ? ` · ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: calendarDoctor.timeZone }).format(calendarDate)}` : ""}</p>
                <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
                  {selectedDaySlots.map((slot) => <button key={slot.startsAt} type="button" aria-pressed={selectedSlotStart === slot.startsAt} onClick={() => setSelectedSlotStart(slot.startsAt)} className={`min-h-11 rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${selectedSlotStart === slot.startsAt ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary hover:bg-primary/5"}`}>
                    {timeRange(slot.startsAt, slot.endsAt, calendarDoctor.timeZone)}
                  </button>)}
                  {!selectedDaySlots.length && <p className="col-span-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">No times available for this date.</p>}
                </div>
                {calendarDoctor.consultModes.length > 1 && <div className="mt-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Appointment type</p><div className="flex gap-2">{calendarDoctor.consultModes.map((mode) => <Button key={mode} type="button" size="sm" variant={selectedMode === mode ? "default" : "outline"} aria-pressed={selectedMode === mode} onClick={() => setSelectedMode(mode)}>{mode}</Button>)}</div></div>}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">{selectedSlot ? `${timeRange(selectedSlot.startsAt, selectedSlot.endsAt, calendarDoctor.timeZone)} · ${selectedMode}` : "Select an available time to continue."}</p>
              <Button type="button" disabled={!selectedSlot || pending || !calendarDoctor.consultModes.includes(selectedMode)} onClick={() => {
                if (!selectedSlot) return;
                requestBooking({ doctorId: calendarDoctor.doctorId, doctorName: calendarDoctor.name, startsAt: selectedSlot.startsAt, consultMode: selectedMode, timeZone: calendarDoctor.timeZone });
              }}>Continue to booking</Button>
            </div>
          </div>
        </div>
      </DialogContent>}
    </Dialog>

    <AlertDialog open={bookingConfirmationOpen} onOpenChange={setBookingConfirmationOpen}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Confirm this appointment?</AlertDialogTitle><AlertDialogDescription>{bookingSelection ? `${bookingSelection.doctorName} · ${displayDate(bookingSelection.startsAt, bookingSelection.timeZone)} · ${bookingSelection.consultMode}. Confirming books the appointment immediately.` : "Confirm your appointment."}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={pending} onClick={() => setBookingSelection(null)}>Go back</AlertDialogCancel><AlertDialogAction disabled={pending || !bookingSelection} onClick={() => {
          const selection = bookingSelection;
          setBookingConfirmationOpen(false);
          setBookingSelection(null);
          if (selection) void completeBooking(selection);
        }}>{pending ? "Booking…" : "Confirm booking"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
