import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function PatientDashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "patient") redirect(session.user.role === "admin" ? "/admin/applications" : "/doctor/onboarding");

  return <main className="mx-auto min-h-screen max-w-5xl space-y-8 px-5 py-12">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <Link href="/" className="font-semibold text-primary">Health-Bridge</Link>
      <span className="text-sm text-muted-foreground">Signed in as {session.user.email}</span>
    </header>
    <section className="rounded-3xl border bg-card p-8 sm:p-12">
      <p className="text-sm font-semibold text-primary">Your patient account</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Welcome, {session.user.name}</h1>
      <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">Your account is ready. Your care conversations and appointments will appear here as those features become available.</p>
      <Link href="/" className="mt-7 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Explore Health-Bridge</Link>
    </section>
  </main>;
}
