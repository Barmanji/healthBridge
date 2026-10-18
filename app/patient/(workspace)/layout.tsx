import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { patientProfiles } from "@/lib/db/schema";

export default async function PatientWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "patient") {
    redirect(session.user.role === "admin" ? "/admin/applications" : "/doctor/onboarding");
  }

  const [profile] = await db.select({ completedAt: patientProfiles.onboardingCompletedAt })
    .from(patientProfiles)
    .where(eq(patientProfiles.userId, session.user.id))
    .limit(1);
  if (!profile?.completedAt) redirect("/patient/onboarding");

  return children;
}
