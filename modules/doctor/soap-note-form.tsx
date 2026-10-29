"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { saveDoctorSoapNote } from "@/modules/doctor/actions";

const initialState = { ok: false, message: "" };

export function SoapNoteForm({ appointmentId, subjective, objective, assessment, plan, reviewed }: {
  appointmentId: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  reviewed: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveDoctorSoapNote, initialState);

  useEffect(() => {
    if (!state.message) return;
    if (state.ok) toast.success(state.message);
    else toast.error("SOAP note was not saved", { description: state.message });
  }, [state]);

  return <form action={formAction} className="mt-4 grid gap-3">
    <input type="hidden" name="appointmentId" value={appointmentId} />
    <label className="grid gap-1 text-sm font-medium">Subjective<textarea name="subjective" maxLength={4000} defaultValue={subjective} className="min-h-20 rounded-xl border bg-background p-3 font-normal" /></label>
    <label className="grid gap-1 text-sm font-medium">Objective<textarea name="objective" maxLength={3000} defaultValue={objective} className="min-h-20 rounded-xl border bg-background p-3 font-normal" /></label>
    <label className="grid gap-1 text-sm font-medium">Assessment<textarea name="assessment" maxLength={4000} defaultValue={assessment} className="min-h-20 rounded-xl border bg-background p-3 font-normal" /></label>
    <label className="grid gap-1 text-sm font-medium">Plan<textarea name="plan" maxLength={4000} defaultValue={plan} className="min-h-20 rounded-xl border bg-background p-3 font-normal" /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reviewed" defaultChecked={reviewed} /> I reviewed this note</label>
    <button type="submit" disabled={pending} className="min-h-10 w-fit rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? "Saving…" : "Save SOAP note"}</button>
  </form>;
}
