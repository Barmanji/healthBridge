import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { doctorAvailabilityRules, doctorProfiles, doctorTimeOff } from "@/lib/db/schema";

export default async function DoctorDashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "doctor") redirect("/");
  const [profile] = await db.select().from(doctorProfiles).where(eq(doctorProfiles.userId, session.user.id)).limit(1);
  if (!profile || profile.verificationStatus !== "verified") redirect("/doctor/onboarding");
  const [schedule, leave] = await Promise.all([
    db.select().from(doctorAvailabilityRules).where(eq(doctorAvailabilityRules.doctorId, profile.id)),
    db.select().from(doctorTimeOff).where(eq(doctorTimeOff.doctorId, profile.id)),
  ]);
  return <main className="mx-auto max-w-5xl space-y-8 px-5 py-12"><p className="text-sm text-primary">Doctor workspace</p><h1 className="text-4xl font-semibold">Welcome, {profile.fullName}</h1><section className="grid gap-4 sm:grid-cols-3"><article className="rounded-2xl border p-5"><p className="text-muted-foreground">Verification</p><p className="mt-2 font-semibold">Verified</p></article><article className="rounded-2xl border p-5"><p className="text-muted-foreground">Weekly availability blocks</p><p className="mt-2 font-semibold">{schedule.length}</p></article><article className="rounded-2xl border p-5"><p className="text-muted-foreground">Planned time off</p><p className="mt-2 font-semibold">{leave.length}</p></article></section><section className="rounded-2xl border p-6"><h2 className="text-xl font-semibold">Your public profile</h2><p className="mt-3">{profile.departmentId ? "Specialization is on file." : "Add a specialization from onboarding."} {profile.city}, {profile.state}</p><p className="mt-3 text-muted-foreground">Availability editing will be available here when scheduling is enabled.</p></section></main>;
}
