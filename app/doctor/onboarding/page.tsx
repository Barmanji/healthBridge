import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { departments, doctorProfiles } from "@/lib/db/schema";
import { OnboardingForm } from "@/modules/doctor/onboarding-form";

export default async function DoctorOnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "doctor") redirect("/");
  await db.insert(doctorProfiles).values({ userId: session.user.id }).onConflictDoNothing({ target: doctorProfiles.userId });
  const [profile] = await db.select().from(doctorProfiles).where(eq(doctorProfiles.userId, session.user.id)).limit(1);
  if (profile.verificationStatus === "verified") redirect("/doctor/dashboard");
  const departmentRows = await db.select({ id: departments.id, name: departments.name }).from(departments).orderBy(departments.name);
  return <main className="mx-auto max-w-4xl space-y-8 px-5 py-12"><header><p className="text-sm text-primary">Doctor verification</p><h1 className="mt-2 text-4xl font-semibold">Complete your application</h1><p className="mt-3 text-muted-foreground">Your profile remains private while our team reviews your credentials.</p></header>
    <div className="rounded-2xl border p-5 text-sm">Status: <strong>{profile.verificationStatus.replaceAll("_", " ")}</strong>{profile.verificationNotes && <p className="mt-2">Reviewer note: {profile.verificationNotes}</p>}</div>
    {profile.verificationStatus === "submitted" || profile.verificationStatus === "under_review" ? <p>Your application is awaiting manual review.</p> : <OnboardingForm profile={profile} departments={departmentRows} />}
  </main>;
}
