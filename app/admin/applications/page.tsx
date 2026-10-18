import { desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { doctorProfiles, user } from "@/lib/db/schema";

export default async function ApplicationsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "admin") redirect("/");
  const rows = await db.select({ profile: doctorProfiles, email: user.email }).from(doctorProfiles).innerJoin(user, eq(user.id, doctorProfiles.userId)).where(inArray(doctorProfiles.verificationStatus, ["submitted", "under_review"])).orderBy(desc(doctorProfiles.submittedAt));
  return <main className="mx-auto max-w-5xl space-y-8 px-5 py-12"><p className="text-sm text-primary">Administration</p><h1 className="text-4xl font-semibold">Doctor applications</h1>{rows.length ? <div className="divide-y rounded-2xl border">{rows.map(({ profile, email }) => <Link key={profile.id} href={`/admin/applications/${profile.id}`} className="flex flex-wrap justify-between gap-3 p-5 hover:bg-muted"><span className="font-medium">{profile.fullName ?? "Unnamed applicant"}<span className="block text-sm text-muted-foreground">{email} · {profile.city ?? "Location pending"}</span></span><span className="text-sm">{profile.verificationStatus.replaceAll("_", " ")}</span></Link>)}</div> : <p className="rounded-2xl border p-6">No applications are awaiting review.</p>}</main>;
}
