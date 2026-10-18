import Link from "next/link";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appointments, departments, doctorProfiles, patientProfiles, user } from "@/lib/db/schema";

const dashboardSections = [
  { href: "/patient/appointments", title: "Appointments", description: "Upcoming and past doctor bookings.", icon: "◷" },
  { href: "/patient/conversations", title: "AI conversations", description: "Your health conversations and summaries.", icon: "✳" },
  { href: "/patient/history", title: "Health history", description: "Keep your health information in one place.", icon: "♡" },
  { href: "/patient/settings", title: "Your profile", description: "Manage your personal details and preferences.", icon: "⚙" },
];

export default async function PatientDashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "patient") redirect(session.user.role === "admin" ? "/admin/applications" : "/doctor/onboarding");
  const [patient] = await db.select({ id: patientProfiles.id }).from(patientProfiles).where(eq(patientProfiles.userId, session.user.id)).limit(1);
  if (!patient) redirect("/patient/onboarding");

  const [counts, featuredDoctors, nextAppointment] = await Promise.all([
    db.select({ doctors: sql<number>`count(*)::int` }).from(doctorProfiles).where(eq(doctorProfiles.verificationStatus, "verified")),
    db.select({ id: doctorProfiles.id, name: sql<string>`coalesce(${doctorProfiles.fullName}, ${user.name})`, department: departments.name, city: doctorProfiles.city, state: doctorProfiles.state, languages: doctorProfiles.languages, yearsExperience: doctorProfiles.yearsExperience })
      .from(doctorProfiles)
      .innerJoin(user, eq(user.id, doctorProfiles.userId))
      .leftJoin(departments, eq(departments.id, doctorProfiles.departmentId))
      .where(eq(doctorProfiles.verificationStatus, "verified"))
      .orderBy(desc(doctorProfiles.verifiedAt))
      .limit(3),
    db.select({ id: appointments.id, startsAt: appointments.startsAt, consultMode: appointments.consultMode, timeZone: doctorProfiles.timeZone, doctorName: sql<string>`coalesce(${doctorProfiles.fullName}, ${user.name})`, department: departments.name })
      .from(appointments).innerJoin(doctorProfiles, eq(doctorProfiles.id, appointments.doctorId)).innerJoin(user, eq(user.id, doctorProfiles.userId)).leftJoin(departments, eq(departments.id, doctorProfiles.departmentId))
      .where(and(eq(appointments.patientId, patient.id), eq(appointments.status, "confirmed"), gt(appointments.startsAt, new Date())))
      .orderBy(asc(appointments.startsAt)).limit(1),
  ]);

  return <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-8 sm:py-10">
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div><p className="text-sm font-semibold text-primary">Your care space</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Welcome, {session.user.name.split(" ")[0]}</h1><p className="mt-2 text-muted-foreground">A clear place to find care and keep track of your health journey.</p></div>
      <Link href="/patient/doctors" className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">Find a doctor <span className="ml-2" aria-hidden="true">→</span></Link>
    </header>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Patient dashboard sections">
      {dashboardSections.map((section) => <Link key={section.href} href={section.href} className="group rounded-2xl border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-xl text-primary" aria-hidden="true">{section.icon}</span><h2 className="mt-5 font-semibold">{section.title}</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{section.description}</p></Link>)}
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
      <article className="rounded-3xl border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Your appointments</h2><p className="mt-1 text-sm text-muted-foreground">Bookings will appear here when you schedule a visit.</p></div><Link href="/patient/appointments" className="text-sm font-semibold text-primary">View all</Link></div>
        <div className="mt-6 rounded-2xl bg-muted/60 p-5">{nextAppointment.length ? <><p className="font-medium">Next visit with {nextAppointment[0].doctorName}</p><p className="mt-1 text-sm text-muted-foreground">{nextAppointment[0].department ?? "Verified clinician"} · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: nextAppointment[0].timeZone }).format(nextAppointment[0].startsAt)} · {nextAppointment[0].consultMode}</p><Link href="/patient/appointments" className="mt-4 inline-flex text-sm font-semibold text-primary underline underline-offset-4">View appointment details</Link></> : <><p className="font-medium">No appointments yet</p><p className="mt-1 text-sm text-muted-foreground">Browse verified doctors to find the right care for you.</p><Link href="/patient/doctors" className="mt-4 inline-flex text-sm font-semibold text-primary underline underline-offset-4">Search doctors</Link></>}</div>
      </article>
      <article className="rounded-3xl border bg-card p-6 sm:p-8"><h2 className="text-xl font-semibold">Care conversations</h2><p className="mt-1 text-sm text-muted-foreground">Your AI agent history will be saved here.</p><div className="mt-6 rounded-2xl bg-muted/60 p-5"><p className="font-medium">Conversation history is ready for you</p><p className="mt-1 text-sm text-muted-foreground">Start a conversation when the guided intake feature is available.</p><Link href="/patient/conversations" className="mt-4 inline-flex text-sm font-semibold text-primary underline underline-offset-4">View conversations</Link></div></article>
    </section>

    <section className="rounded-3xl border bg-card p-6 sm:p-8"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-primary">Reviewed clinicians</p><h2 className="mt-1 text-xl font-semibold">Explore verified doctors</h2></div><p className="text-sm text-muted-foreground">{counts[0]?.doctors ?? 0} available profiles</p></div>
      {featuredDoctors.length ? <div className="mt-5 grid gap-3 md:grid-cols-3">{featuredDoctors.map((doctor) => <article key={doctor.id} className="rounded-2xl border p-4"><p className="font-semibold">{doctor.name}</p><p className="mt-1 text-sm text-primary">{doctor.department ?? "Specialty pending"}</p><p className="mt-2 text-sm text-muted-foreground">{[doctor.city, doctor.state].filter(Boolean).join(", ") || "Location not listed"}</p><p className="mt-1 text-xs text-muted-foreground">{doctor.languages.length ? doctor.languages.join(", ") : "Languages not listed"}{doctor.yearsExperience !== null ? ` · ${doctor.yearsExperience} years' experience` : ""}</p></article>)}</div> : <p className="mt-5 rounded-2xl bg-muted/60 p-5 text-sm text-muted-foreground">Verified doctor profiles will appear here when available.</p>}
      <Link href="/patient/doctors" className="mt-5 inline-flex text-sm font-semibold text-primary underline underline-offset-4">Search all doctors</Link>
    </section>
  </main>;
}
