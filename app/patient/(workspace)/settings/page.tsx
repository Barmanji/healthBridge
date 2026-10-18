import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { patientProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PatientSettingsForm } from "@/modules/patient/settings-form";

export default async function PatientSettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "patient") redirect(session.user.role === "admin" ? "/admin/applications" : "/doctor/onboarding");
  const [profile] = await db.select().from(patientProfiles).where(eq(patientProfiles.userId, session.user.id)).limit(1);
  if (!profile?.onboardingCompletedAt) redirect("/patient/onboarding");
  return <main className="mx-auto max-w-5xl space-y-7 px-4 py-8 sm:px-8 sm:py-10"><header><p className="text-sm font-semibold text-primary">Your account</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Profile & settings</h1><p className="mt-2 text-muted-foreground">Update the personal details used for your Health-Bridge account.</p></header><PatientSettingsForm name={session.user.name} email={session.user.email} image={session.user.image ?? null} preferredLanguage={profile.preferredLanguage} emergencyContactName={profile.emergencyContactName} emergencyContactPhone={profile.emergencyContactPhone} /><section className="rounded-2xl border bg-muted/40 p-5"><h2 className="font-semibold">Health information</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Medication and medical-history tools will be added with clear consent and privacy controls. No health records are stored from this page yet.</p></section></main>;
}
