"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProfilePhoto } from "@/components/ui/profile-photo";
import { readVerifiedDoctorSnapshot, saveVerifiedDoctorSnapshot, type CachedDoctor } from "@/lib/patient/offline-directory-cache";

export function DoctorDirectoryResults({ doctors }: { doctors: CachedDoctor[] }) {
  const [offline, setOffline] = useState(false);
  const [offlineSnapshot, setOfflineSnapshot] = useState<{ doctors: CachedDoctor[]; savedAt: number } | null>(null);

  useEffect(() => {
    let active = true;
    void saveVerifiedDoctorSnapshot(doctors);

    const goOffline = async () => {
      setOffline(true);
      const snapshot = await readVerifiedDoctorSnapshot();
      if (active && snapshot) setOfflineSnapshot({ doctors: snapshot.doctors, savedAt: snapshot.savedAt });
    };
    const goOnline = () => {
      setOffline(false);
      setOfflineSnapshot(null);
      void saveVerifiedDoctorSnapshot(doctors);
    };

    if (!navigator.onLine) void goOffline();
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      active = false;
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [doctors]);

  const visibleDoctors = offline && offlineSnapshot ? offlineSnapshot.doctors : doctors;
  const savedDate = offlineSnapshot ? new Date(offlineSnapshot.savedAt).toLocaleString() : "";

  return <>
    {offline && <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-foreground">You’re offline. Showing the last saved public doctor directory{savedDate ? ` from ${savedDate}` : ""}. Contact details and appointments need a connection.</p>}
    <p className="text-sm text-muted-foreground">{visibleDoctors.length} verified {visibleDoctors.length === 1 ? "doctor" : "doctors"}{visibleDoctors.length === 60 ? " (showing first 60; refine your search)" : ""}</p>
    {visibleDoctors.length ? <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleDoctors.map((doctor) => <article key={doctor.id} className="flex flex-col rounded-2xl border bg-card p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><ProfilePhoto src={doctor.image} name={doctor.name} className="size-16 text-xl" /><div><p className="text-lg font-semibold">{doctor.name}</p><p className="mt-1 text-sm font-medium text-primary">{doctor.department ?? "Specialty pending"}</p></div></div><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Verified</span></div><p className="mt-3 text-sm text-muted-foreground">{[doctor.city, doctor.state].filter(Boolean).join(", ") || "Location not listed"}</p><p className="mt-2 text-sm">{doctor.languages.length ? doctor.languages.join(", ") : "Languages not listed"}</p><p className="mt-2 text-sm text-muted-foreground">{doctor.yearsExperience === null ? "Experience not listed" : `${doctor.yearsExperience} years' experience`}{doctor.consultModes.length ? ` · ${doctor.consultModes.join(" / ")}` : ""}</p>{doctor.feeInr !== null && <p className="mt-2 text-sm">Consultation fee: ₹{doctor.feeInr}</p>}{doctor.bio && <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{doctor.bio}</p>}<Link href={`/patient/doctors/${doctor.id}`} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-semibold hover:bg-muted">View profile</Link></article>)}</section> : <section className="rounded-2xl border bg-card p-8 text-center"><h2 className="text-lg font-semibold">No verified doctors match those filters</h2><p className="mt-2 text-sm text-muted-foreground">Try another specialty or location. Only approved doctor profiles appear here.</p><Link href="/patient/doctors" className="mt-4 inline-flex text-sm font-semibold text-primary underline underline-offset-4">Clear filters</Link></section>}
  </>;
}
