"use client";

import { useState } from "react";
import { saveDoctorStep, submitDoctorApplication } from "@/modules/doctor/actions";
import type { doctorProfiles } from "@/lib/db/schema";

type DoctorProfile = typeof doctorProfiles.$inferSelect;

const fields = [
  ["fullName", "Full legal name"], ["phone", "Phone with country code"], ["city", "City"], ["state", "State"], ["dateOfBirth", "Date of birth"],
  ["registrationNumber", "Medical registration number"], ["registrationCouncil", "Medical council"],
  ["registrationYear", "Registration year"], ["departmentId", "Department"], ["yearsExperience", "Years of experience"],
  ["clinicName", "Clinic name (optional)"], ["clinicAddress", "Clinic address (optional)"],
] as const;

export function OnboardingForm({ profile, departments, documents }: { profile: DoctorProfile; departments: { id: string; name: string }[]; documents: { id: string; type: string; originalName: string }[] }) {
  const [values, setValues] = useState<Record<string, string>>({
    fullName: profile.fullName ?? "", phone: profile.phone ?? "", city: profile.city ?? "", state: profile.state ?? "",
    registrationNumber: profile.registrationNumber ?? "", registrationCouncil: profile.registrationCouncil ?? "",
    registrationYear: profile.registrationYear?.toString() ?? "", departmentId: profile.departmentId ?? "",
    yearsExperience: profile.yearsExperience?.toString() ?? "", clinicName: profile.clinicName ?? "", clinicAddress: profile.clinicAddress ?? "", dateOfBirth: profile.dateOfBirth?.toISOString?.().slice(0,10) ?? "",
    degree: profile.qualifications?.[0]?.degree ?? "", institution: profile.qualifications?.[0]?.institution ?? "", qualificationYear: profile.qualifications?.[0]?.year?.toString() ?? "",
    languages: profile.languages?.join(", ") ?? "English", consultModes: profile.consultModes?.join(",") ?? "video",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState({ terms: false, data: false, telemedicine: false });
  const set = (key: string, value: string) => setValues((old) => ({ ...old, [key]: value }));
  async function save() {
    setBusy(true); setMessage("");
    const personal = await saveDoctorStep(2, { ...values, gender: "", bio: "" });
    if (!personal.ok) { setMessage(personal.message); setBusy(false); return; }
    const professional = await saveDoctorStep(3, {
      ...values, registrationYear: Number(values.registrationYear), yearsExperience: Number(values.yearsExperience),
      subSpecialties: [], qualifications: [{ degree: values.degree, institution: values.institution, year: Number(values.qualificationYear) }],
    });
    if (!professional.ok) { setMessage(professional.message); setBusy(false); return; }
    const practice = await saveDoctorStep(4, { clinicName: values.clinicName, clinicAddress: values.clinicAddress, languages: values.languages.split(",").map((x) => x.trim()).filter(Boolean), consultModes: values.consultModes.split(",").map((x) => x.trim()).filter(Boolean), feeInr: undefined });
    if (!practice.ok) { setMessage(practice.message); setBusy(false); return; }
    const availability = await saveDoctorStep(5, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata", slotMinutes: 15, bufferMinutes: 0, weeklySchedule: [{ weekday: 1, startTime: "09:00", endTime: "17:00" }], plannedLeave: [] });
    setMessage(availability.ok ? "Profile saved. Add required documents below, then submit for review." : availability.message);
    setBusy(false);
  }
  async function upload(form: FormData) {
    setBusy(true); setMessage("");
    const response = await fetch("/api/doctor/documents", { method: "POST", body: form });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Document uploaded. Refresh this page to see it." : result.error ?? "Upload failed.");
    setBusy(false);
  }
  async function submit() {
    setBusy(true);
    const result = await submitDoctorApplication({ acceptedTerms: accepted.terms, acceptedDataProcessing: accepted.data, acceptedTelemedicineDeclaration: accepted.telemedicine });
    setMessage(result.ok ? "Application submitted for manual review." : result.message);
    setBusy(false);
  }
  return <div className="space-y-8">
    <section className="grid gap-4 sm:grid-cols-2">{fields.map(([key, label]) => <label key={key} className="grid gap-2 text-sm">{label}
      {key === "departmentId" ? <select value={values[key]} onChange={(e) => set(key, e.target.value)} className="rounded-xl border bg-background px-3 py-3"><option value="">Choose department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select> : <input required={!key.startsWith("clinic")} type={key === "dateOfBirth" ? "date" : key.endsWith("Year") || key === "yearsExperience" ? "number" : "text"} value={values[key]} onChange={(e) => set(key, e.target.value)} className="rounded-xl border bg-background px-3 py-3" />}
    </label>)}</section>
    <section className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">Degree<input value={values.degree} onChange={(e) => set("degree",e.target.value)} className="rounded-xl border bg-background px-3 py-3" /></label><label className="grid gap-2 text-sm">Institution<input value={values.institution} onChange={(e) => set("institution",e.target.value)} className="rounded-xl border bg-background px-3 py-3" /></label><label className="grid gap-2 text-sm">Graduation year<input type="number" value={values.qualificationYear} onChange={(e) => set("qualificationYear",e.target.value)} className="rounded-xl border bg-background px-3 py-3" /></label><label className="grid gap-2 text-sm">Languages (comma separated)<input value={values.languages} onChange={(e) => set("languages",e.target.value)} className="rounded-xl border bg-background px-3 py-3" /></label><label className="grid gap-2 text-sm">Consult modes: video, audio<input value={values.consultModes} onChange={(e) => set("consultModes",e.target.value)} className="rounded-xl border bg-background px-3 py-3" /></label></section>
    <button disabled={busy} onClick={save} className="rounded-xl bg-primary px-5 py-3 text-primary-foreground">Save profile</button>
    <section className="space-y-4 rounded-2xl border p-5"><h2 className="text-xl font-semibold">Required documents</h2><p className="text-sm text-muted-foreground">PDF, PNG, or JPEG; maximum 10 MB each.</p>
      {["registration_certificate", "degree_certificate", "government_id", "profile_photo"].map((type) => <form key={type} action={upload} className="flex flex-wrap items-center gap-3 border-b py-3"><input type="hidden" name="type" value={type} /><span className="min-w-48 text-sm">{type.replaceAll("_", " ")}</span><input name="file" type="file" accept={type === "profile_photo" ? "image/png,image/jpeg" : "application/pdf,image/png,image/jpeg"} required /><button disabled={busy} className="rounded-lg border px-3 py-2">Upload</button><span className="text-xs text-muted-foreground">{documents.filter((d) => d.type === type).map((d) => d.originalName).join(", ")}</span></form>)}
    </section>
    <section className="space-y-3 rounded-2xl border p-5"><h2 className="text-xl font-semibold">Declarations</h2>{([["terms", "I agree to the terms of service."], ["data", "I consent to processing my information and credentials for verification."], ["telemedicine", "I confirm I will follow applicable telemedicine requirements."]] as const).map(([key, label]) => <label key={key} className="flex gap-3 text-sm"><input type="checkbox" checked={accepted[key]} onChange={(e) => setAccepted((old) => ({ ...old, [key]: e.target.checked }))}/>{label}</label>)}</section>
    <button disabled={busy || !accepted.terms || !accepted.data || !accepted.telemedicine} onClick={submit} className="rounded-xl bg-primary px-5 py-3 text-primary-foreground">Submit for verification</button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
