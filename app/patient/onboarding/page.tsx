import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { patientProfiles } from "@/lib/db/schema";
import { PatientOnboardingForm } from "@/modules/patient/onboarding-form";

export default async function PatientOnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "patient") {
    redirect(session.user.role === "admin" ? "/admin/applications" : "/doctor/onboarding");
  }

  const [profile] = await db.select({ completedAt: patientProfiles.onboardingCompletedAt })
    .from(patientProfiles)
    .where(eq(patientProfiles.userId, session.user.id))
    .limit(1);
  if (profile?.completedAt) redirect("/patient/dashboard");

  return <main className="mx-auto max-w-3xl space-y-7 px-4 py-8 sm:px-8 sm:py-12">
    <header>
      <p className="text-sm font-semibold text-primary">A few details first</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Set up your care profile</h1>
      <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">Choose your preferred app language and add an emergency contact if you have one. You can update these details later in Profile &amp; settings.</p>
    </header>
    <PatientOnboardingForm name={session.user.name} />
    <p className="text-xs leading-relaxed text-muted-foreground">Health-Bridge provides triage assistance only. It does not diagnose or replace a licensed clinician or emergency services.</p>
  </main>;
}
