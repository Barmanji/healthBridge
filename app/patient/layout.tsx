import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ModeToggle } from "@/components/mode-toggle";
import { auth } from "@/lib/auth";
import UserButton from "@/modules/auth/components/user-button";
import { PatientNav } from "@/modules/patient/patient-nav";
import { RegisterServiceWorker } from "@/modules/patient/register-service-worker";

export default async function PatientLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "patient") redirect(session.user.role === "admin" ? "/admin/applications" : "/doctor/onboarding");

  return <div className="flex min-h-dvh flex-col">
    <RegisterServiceWorker />
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center border-b bg-card">
      <div className="flex h-full w-full items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/patient/dashboard" className="flex items-center gap-2 font-semibold tracking-tight"><span className="flex size-9 items-center justify-center rounded-xl bg-primary text-lg text-primary-foreground" aria-hidden="true">+</span><span>health<span className="text-primary">bridge</span></span></Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <ModeToggle />
          <UserButton user={{ name: session.user.name, email: session.user.email, image: session.user.image, createdAt: session.user.createdAt }} dashboardHref="/patient/dashboard" settingsHref="/patient/settings" />
        </div>
      </div>
    </header>
    <div className="flex w-full min-w-0 flex-col sm:flex-row">
      <PatientNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  </div>;
}
