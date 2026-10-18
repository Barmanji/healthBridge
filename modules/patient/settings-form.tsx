"use client";

import { useState, useTransition } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { updatePatientProfile } from "@/modules/patient/actions";
import { patientLanguages } from "@/modules/patient/schemas";

export function PatientSettingsForm({ name, email, image, preferredLanguage, emergencyContactName, emergencyContactPhone }: {
  name: string;
  email: string;
  image: string | null;
  preferredLanguage: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}) {
  const [displayName, setDisplayName] = useState(name);
  const [language, setLanguage] = useState(preferredLanguage);
  const [contactName, setContactName] = useState(emergencyContactName ?? "");
  const [contactPhone, setContactPhone] = useState(emergencyContactPhone ?? "");
  const [avatar, setAvatar] = useState(image);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, startSaving] = useTransition();

  function saveProfile() {
    setStatus("");
    startSaving(async () => {
      const result = await updatePatientProfile({
        name: displayName,
        preferredLanguage: language,
        emergencyContactName: contactName,
        emergencyContactPhone: contactPhone,
      });
      setStatus(result.message);
    });
  }

  async function uploadImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus("");
    const payload = new FormData();
    payload.set("file", file);
    try {
      const response = await fetch("/api/patient/profile-image", { method: "POST", body: payload });
      const result = await response.json();
      if (!response.ok) {
        setStatus(result.error ?? "Image upload failed.");
      } else {
        setAvatar(result.imageUrl);
        setStatus("Profile photo updated.");
      }
    } catch {
      setStatus("Image upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return <div className="space-y-6">
    <section className="flex flex-wrap items-center gap-5 rounded-2xl border p-5">
      <Avatar className="size-20"><AvatarImage src={avatar ?? undefined} alt="Your profile photo" /><AvatarFallback className="bg-primary text-xl font-semibold text-primary-foreground">{name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
      <div className="min-w-56 flex-1"><h2 className="font-semibold">Profile photo</h2><p className="mt-1 text-sm text-muted-foreground">PNG, JPEG, or WebP · up to 5 MB. Visible only to you.</p><label className="mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted">{busy ? "Uploading…" : "Choose a photo"}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={uploadImage} disabled={busy} /></label></div>
    </section>
    <section className="space-y-5 rounded-2xl border p-5"><h2 className="text-lg font-semibold">Personal details</h2><label className="grid max-w-xl gap-2 text-sm font-medium">Full name<input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} className="h-11 rounded-xl border bg-background px-3 font-normal" /></label><label className="grid max-w-xl gap-2 text-sm font-medium">Verified email<input value={email} readOnly className="h-11 rounded-xl border bg-muted px-3 font-normal text-muted-foreground" /></label><label className="grid max-w-xl gap-2 text-sm font-medium">Preferred app language<select value={language} onChange={(event) => setLanguage(event.target.value)} className="h-11 rounded-xl border bg-background px-3 font-normal">{patientLanguages.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label><fieldset className="grid max-w-xl gap-3"><legend className="text-sm font-medium">Emergency contact <span className="font-normal text-muted-foreground">(optional)</span></legend><input aria-label="Emergency contact name" value={contactName} maxLength={80} onChange={(event) => setContactName(event.target.value)} placeholder="Contact name" className="h-11 rounded-xl border bg-background px-3 font-normal" /><input aria-label="Emergency contact phone" type="tel" value={contactPhone} maxLength={32} onChange={(event) => setContactPhone(event.target.value)} placeholder="Contact phone" className="h-11 rounded-xl border bg-background px-3 font-normal" /></fieldset><Button onClick={saveProfile} disabled={saving || busy}>{saving ? "Saving…" : "Save profile"}</Button></section>
    {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
  </div>;
}
