"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ProfilePhoto } from "@/components/ui/profile-photo";
import { saveDoctorStep, submitDoctorApplication } from "@/modules/doctor/actions";
import type { doctorProfiles } from "@/lib/db/schema";

type DoctorProfile = typeof doctorProfiles.$inferSelect;
type Department = { id: string; name: string };

const fields = [
  { key: "fullName", label: "Full legal name", required: true },
  { key: "phone", label: "Phone with country code", required: true },
  { key: "city", label: "City", required: true },
  { key: "state", label: "State", required: true },
  { key: "dateOfBirth", label: "Date of birth", required: false },
  { key: "registrationNumber", label: "Medical registration number", required: true },
  { key: "registrationCouncil", label: "Medical council", required: true },
  { key: "registrationYear", label: "Registration year", required: true },
  { key: "departmentId", label: "Department", required: true },
  { key: "yearsExperience", label: "Years of experience", required: true },
  { key: "clinicName", label: "Clinic name (optional)", required: false },
  { key: "clinicAddress", label: "Clinic address (optional)", required: false },
] as const;

const declarationFields = [
  ["terms", "I agree to the terms of service."],
  ["data", "I consent to processing my information and credentials for verification."],
  ["telemedicine", "I confirm I will follow applicable telemedicine requirements."],
] as const;

function RequiredMarker() {
  return <><span aria-hidden="true" className="ml-1 text-red-600">*</span><span className="sr-only"> required</span></>;
}

export function OnboardingForm({ profile, departments, profileImage }: { profile: DoctorProfile; departments: Department[]; profileImage: string | null }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Record<string, string>>({
    fullName: profile.fullName ?? "", phone: profile.phone ?? "", city: profile.city ?? "", state: profile.state ?? "",
    registrationNumber: profile.registrationNumber ?? "", registrationCouncil: profile.registrationCouncil ?? "",
    registrationYear: profile.registrationYear?.toString() ?? "", departmentId: profile.departmentId ?? "",
    yearsExperience: profile.yearsExperience?.toString() ?? "", clinicName: profile.clinicName ?? "", clinicAddress: profile.clinicAddress ?? "",
    dateOfBirth: profile.dateOfBirth?.toISOString?.().slice(0, 10) ?? "",
    degree: profile.qualifications?.[0]?.degree ?? "", institution: profile.qualifications?.[0]?.institution ?? "",
    qualificationYear: profile.qualifications?.[0]?.year?.toString() ?? "",
    languages: profile.languages?.join(", ") ?? "English", consultModes: profile.consultModes?.join(",") ?? "video",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState<string | null>(profileImage);
  const [uploading, setUploading] = useState(false);
  const [accepted, setAccepted] = useState({ terms: false, data: false, telemedicine: false });
  const set = (key: string, value: string) => setValues((old) => ({ ...old, [key]: value }));

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage("");
    const payload = new FormData();
    payload.set("file", file);
    try {
      const response = await fetch("/api/doctor/profile-image", { method: "POST", body: payload });
      const result = await response.json().catch(() => ({})) as { imageUrl?: string; error?: string };
      if (!response.ok || !result.imageUrl) {
        setMessage(result.error ?? "The photo could not be saved. Please try again.");
      } else {
        setPhoto(result.imageUrl);
        setMessage("Profile photo saved.");
      }
    } catch {
      setMessage("The photo could not be saved. Check your connection and try again.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function persistProfile() {
    const personal = await saveDoctorStep(2, { ...values, gender: "", bio: "" });
    if (!personal.ok) return personal;

    const professional = await saveDoctorStep(3, {
      ...values,
      registrationYear: Number(values.registrationYear),
      yearsExperience: Number(values.yearsExperience),
      subSpecialties: [],
      qualifications: [{ degree: values.degree, institution: values.institution, year: Number(values.qualificationYear) }],
    });
    if (!professional.ok) return professional;

    const practice = await saveDoctorStep(4, {
      clinicName: values.clinicName,
      clinicAddress: values.clinicAddress,
      languages: values.languages.split(",").map((value) => value.trim()).filter(Boolean),
      consultModes: values.consultModes.split(",").map((value) => value.trim()).filter(Boolean),
      feeInr: undefined,
    });
    if (!practice.ok) return practice;

    const availability = await saveDoctorStep(5, {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
      slotMinutes: 15,
      bufferMinutes: 0,
      weeklySchedule: [{ weekday: 1, startTime: "09:00", endTime: "17:00" }],
      plannedLeave: [],
    });
    return availability.ok ? { ok: true as const } : availability;
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await persistProfile();
      setMessage(result.ok ? "Profile saved. You can submit it for manual review." : result.message);
    } catch {
      setMessage("Could not save your profile. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (busy) return;
    if (!photo) {
      setMessage("Upload a profile photo before submitting your application.");
      return;
    }
    if (!accepted.terms || !accepted.data || !accepted.telemedicine) {
      setMessage("Accept all three declarations before submitting.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const saved = await persistProfile();
      if (!saved.ok) {
        setMessage(saved.message);
        return;
      }
      const result = await submitDoctorApplication({
        acceptedTerms: accepted.terms,
        acceptedDataProcessing: accepted.data,
        acceptedTelemedicineDeclaration: accepted.telemedicine,
      });
      setMessage(result.ok ? "Application submitted for manual review." : result.message);
    } catch {
      setMessage("Could not submit your application. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent = (event.nativeEvent as SubmitEvent).submitter instanceof HTMLElement
      ? (event.nativeEvent as SubmitEvent).submitter?.getAttribute("data-intent")
      : "save";
    if (intent === "submit") void submit();
    else void save();
  }

  return <form ref={formRef} onSubmit={handleSubmit} className="space-y-8">
    <section className="flex flex-wrap items-center gap-5 rounded-2xl border p-5">
      <ProfilePhoto src={photo} name={values.fullName || "Doctor"} className="size-24 text-2xl" sizes="96px" />
      <div className="min-w-56 flex-1">
        <h2 className="font-semibold">Profile photo<RequiredMarker /></h2>
        <p className="mt-1 text-sm text-muted-foreground">Shown on your public doctor listing. PNG, JPEG, or WebP · up to 5 MB.</p>
        <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted">
          {uploading ? "Uploading…" : photo ? "Replace photo" : "Choose a photo"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={uploadPhoto} disabled={uploading} />
        </label>
        {!photo && <p className="mt-2 text-xs text-red-600">A profile photo is required before you can submit.</p>}
      </div>
    </section>

    <p className="text-sm text-muted-foreground"><span className="text-red-600">*</span> Required fields</p>
    <section className="grid gap-4 sm:grid-cols-2">
      {fields.map(({ key, label, required }) => <label key={key} className="grid gap-2 text-sm">
        <span>{label}{required && <RequiredMarker />}</span>
        {key === "departmentId" ? <>
          <select required value={values[key]} onChange={(event) => set(key, event.target.value)} className="rounded-xl border bg-background px-3 py-3">
            <option value="">{departments.length ? "Choose specialization" : "No specializations available"}</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
          {!departments.length && <span className="text-xs text-muted-foreground">Specializations are not configured yet. Please contact support.</span>}
        </> : <input
          required={required}
          type={key === "dateOfBirth" ? "date" : key === "registrationYear" || key === "yearsExperience" ? "number" : "text"}
          min={key === "registrationYear" ? 1900 : key === "yearsExperience" ? 0 : undefined}
          max={key === "registrationYear" ? new Date().getFullYear() : key === "yearsExperience" ? 80 : undefined}
          value={values[key]}
          onChange={(event) => set(key, event.target.value)}
          className="rounded-xl border bg-background px-3 py-3"
        />}
      </label>)}
    </section>

    <section className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-sm"><span>Degree<RequiredMarker /></span><input required value={values.degree} onChange={(event) => set("degree", event.target.value)} className="rounded-xl border bg-background px-3 py-3" /></label>
      <label className="grid gap-2 text-sm"><span>Institution<RequiredMarker /></span><input required value={values.institution} onChange={(event) => set("institution", event.target.value)} className="rounded-xl border bg-background px-3 py-3" /></label>
      <label className="grid gap-2 text-sm"><span>Graduation year<RequiredMarker /></span><input required type="number" min={1900} max={new Date().getFullYear()} value={values.qualificationYear} onChange={(event) => set("qualificationYear", event.target.value)} className="rounded-xl border bg-background px-3 py-3" /></label>
      <label className="grid gap-2 text-sm"><span>Languages (comma separated)<RequiredMarker /></span><input required value={values.languages} onChange={(event) => set("languages", event.target.value)} className="rounded-xl border bg-background px-3 py-3" /></label>
      <label className="grid gap-2 text-sm"><span>Consult modes: video, audio<RequiredMarker /></span><input required value={values.consultModes} onChange={(event) => set("consultModes", event.target.value)} className="rounded-xl border bg-background px-3 py-3" /></label>
    </section>

    <div className="flex flex-wrap gap-3">
      <button type="submit" data-intent="save" disabled={busy} className="rounded-xl bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : "Save profile"}</button>
    </div>

    <section className="space-y-3 rounded-2xl border p-5">
      <h2 className="text-xl font-semibold">Declarations</h2>
      {declarationFields.map(([key, label]) => <label key={key} className="flex gap-3 text-sm">
        <input
          type="checkbox"
          checked={accepted[key]}
          onChange={(event) => setAccepted((old) => ({ ...old, [key]: event.target.checked }))}
        />
        <span>{label}<RequiredMarker /></span>
      </label>)}
    </section>

    <button type="submit" data-intent="submit" disabled={busy || !photo} className="rounded-xl bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50">{busy ? "Submitting…" : "Submit for verification"}</button>
    {!photo && <p className="text-xs text-muted-foreground">Add a profile photo above to enable submission.</p>}
    {message && <p role="status" aria-live="polite" className="text-sm">{message}</p>}
  </form>;
}
