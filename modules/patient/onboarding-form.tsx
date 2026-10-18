"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { completePatientOnboarding } from "@/modules/patient/actions";
import { patientLanguages } from "@/modules/patient/schemas";

export function PatientOnboardingForm({ name }: { name: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [preferredLanguage, setPreferredLanguage] = useState("en-IN");
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const values = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await completePatientOnboarding({
        name: values.get("name"),
        preferredLanguage,
        emergencyContactName: values.get("emergencyContactName"),
        emergencyContactPhone: values.get("emergencyContactPhone"),
        consent,
      });
      setMessage(result.message);
      if (result.ok) {
        router.replace("/patient/dashboard");
        router.refresh();
      }
    });
  }

  return <form onSubmit={submit} className="space-y-6 rounded-3xl border bg-card p-5 shadow-sm sm:p-8">
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Your details</h2>
      <label className="grid gap-2 text-sm font-medium" htmlFor="patient-name">Full name
        <input id="patient-name" name="name" required minLength={2} maxLength={80} defaultValue={name} autoComplete="name" className="h-12 rounded-xl border bg-background px-3 font-normal" />
      </label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="preferred-language">Preferred app language
        <select id="preferred-language" value={preferredLanguage} onChange={(event) => setPreferredLanguage(event.target.value)} className="h-12 rounded-xl border bg-background px-3 font-normal">
          {patientLanguages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
        </select>
      </label>
      <p className="text-xs leading-relaxed text-muted-foreground">This sets your app preference. Voice and AI support for each language will be confirmed separately before those features launch.</p>
    </section>

    <section className="space-y-4 border-t pt-6">
      <div><h2 className="text-lg font-semibold">Emergency contact <span className="text-sm font-normal text-muted-foreground">(optional)</span></h2><p className="mt-1 text-sm text-muted-foreground">Add someone you trust. This prototype does not call or message contacts.</p></div>
      <label className="grid gap-2 text-sm font-medium" htmlFor="emergency-contact-name">Contact name
        <input id="emergency-contact-name" name="emergencyContactName" maxLength={80} autoComplete="off" className="h-12 rounded-xl border bg-background px-3 font-normal" />
      </label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="emergency-contact-phone">Contact phone
        <input id="emergency-contact-phone" name="emergencyContactPhone" type="tel" maxLength={32} autoComplete="off" placeholder="Include country code if needed" className="h-12 rounded-xl border bg-background px-3 font-normal" />
      </label>
    </section>

    <section className="space-y-4 border-t pt-6">
      <h2 className="text-lg font-semibold">Your choice</h2>
      <label className="flex items-start gap-3 text-sm leading-relaxed">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 size-4 accent-primary" />
        <span>I agree to save the profile details above to my Health-Bridge account so the app can use my preferred language and emergency contact. I understand I can change or remove these details later.</span>
      </label>
    </section>

    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    <button type="submit" disabled={isPending || !consent} className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">
      {isPending ? "Saving your profile…" : "Continue to dashboard"}
    </button>
  </form>;
}
