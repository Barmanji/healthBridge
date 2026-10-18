import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { departments, doctorProfiles, user } from "@/lib/db/schema";

export default async function PublicDoctorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [doctor] = await db.select({ id: doctorProfiles.id, status: doctorProfiles.verificationStatus, name: sql<string>`coalesce(${doctorProfiles.fullName}, ${user.name})`, bio: doctorProfiles.bio, department: departments.name, city: doctorProfiles.city, state: doctorProfiles.state, languages: doctorProfiles.languages, consultModes: doctorProfiles.consultModes, yearsExperience: doctorProfiles.yearsExperience, qualifications: doctorProfiles.qualifications, clinicName: doctorProfiles.clinicName, feeInr: doctorProfiles.feeInr })
    .from(doctorProfiles)
    .innerJoin(user, eq(user.id, doctorProfiles.userId))
    .leftJoin(departments, eq(departments.id, doctorProfiles.departmentId))
    .where(eq(doctorProfiles.id, id))
    .limit(1);
  if (!doctor || doctor.status !== "verified") notFound();

  return <main className="mx-auto max-w-4xl space-y-7 px-4 py-8 sm:px-8 sm:py-10">
    <Link href="/patient/doctors" className="text-sm font-semibold text-primary underline underline-offset-4">← Back to doctors</Link>
    <section className="rounded-3xl border bg-card p-6 sm:p-9"><div className="flex flex-wrap items-start justify-between gap-4"><div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Credentials reviewed</span><h1 className="mt-4 text-3xl font-semibold">{doctor.name}</h1><p className="mt-2 text-lg text-primary">{doctor.department ?? "Specialty not listed"}</p></div><div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-2xl font-semibold text-primary" aria-hidden="true">{doctor.name.slice(0,1).toUpperCase()}</div></div>
      <div className="mt-7 grid gap-5 border-t pt-6 sm:grid-cols-2"><div><p className="text-sm text-muted-foreground">Location</p><p className="mt-1">{[doctor.city, doctor.state].filter(Boolean).join(", ") || "Not listed"}</p></div><div><p className="text-sm text-muted-foreground">Experience</p><p className="mt-1">{doctor.yearsExperience === null ? "Not listed" : `${doctor.yearsExperience} years`}</p></div><div><p className="text-sm text-muted-foreground">Languages</p><p className="mt-1">{doctor.languages.length ? doctor.languages.join(", ") : "Not listed"}</p></div><div><p className="text-sm text-muted-foreground">Consultation modes</p><p className="mt-1">{doctor.consultModes.length ? doctor.consultModes.join(", ") : "Not listed"}</p></div>{doctor.feeInr !== null && <div><p className="text-sm text-muted-foreground">Consultation fee</p><p className="mt-1">₹{doctor.feeInr}</p></div>}{doctor.clinicName && <div><p className="text-sm text-muted-foreground">Practice</p><p className="mt-1">{doctor.clinicName}</p></div>}</div>
      {doctor.bio && <div className="mt-6 border-t pt-6"><h2 className="font-semibold">About</h2><p className="mt-2 whitespace-pre-wrap leading-relaxed text-muted-foreground">{doctor.bio}</p></div>}
      {doctor.qualifications.length > 0 && <div className="mt-6 border-t pt-6"><h2 className="font-semibold">Qualifications</h2><ul className="mt-3 space-y-2">{doctor.qualifications.map((qualification, index) => <li key={`${qualification.degree}-${index}`} className="text-sm">{qualification.degree} · {qualification.institution} ({qualification.year})</li>)}</ul></div>}
      <div className="mt-7 rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">Appointment booking is not available yet. You can review this verified profile and return when scheduling launches.</div>
    </section>
  </main>;
}
