import { eq } from "drizzle-orm";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { departments, doctorDocuments, doctorProfiles, user } from "@/lib/db/schema";
import { ReviewControls } from "@/modules/doctor/review-controls";

export default async function ApplicationReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "admin") redirect("/");
  const { id } = await params;
  const [result] = await db.select({ profile: doctorProfiles, email: user.email, department: departments.name }).from(doctorProfiles).innerJoin(user, eq(user.id, doctorProfiles.userId)).leftJoin(departments, eq(departments.id, doctorProfiles.departmentId)).where(eq(doctorProfiles.id, id)).limit(1);
  if (!result) notFound();
  const docs = await db.select().from(doctorDocuments).where(eq(doctorDocuments.doctorId, id));
  const p = result.profile;
  return <main className="mx-auto max-w-5xl space-y-8 px-5 py-12"><Link className="text-sm text-primary" href="/admin/applications">← All applications</Link><header><p className="text-sm text-primary">{p.verificationStatus.replaceAll("_", " ")}</p><h1 className="mt-2 text-4xl font-semibold">{p.fullName}</h1><p className="mt-2 text-muted-foreground">{result.email}</p></header><section className="grid gap-4 rounded-2xl border p-6 sm:grid-cols-2">{[["Phone", p.phone], ["Location", `${p.city ?? ""}, ${p.state ?? ""}`], ["Registration", `${p.registrationNumber ?? ""} · ${p.registrationCouncil ?? ""} (${p.registrationYear ?? ""})`], ["Specialization", result.department], ["Experience", p.yearsExperience], ["Qualifications", p.qualifications.map((q) => `${q.degree}, ${q.institution} (${q.year})`).join("; ")], ["Languages", p.languages.join(", ")], ["Modes", p.consultModes.join(", ")]].map(([k,v]) => <div key={String(k)}><p className="text-sm text-muted-foreground">{k}</p><p className="mt-1">{String(v ?? "Not provided")}</p></div>)}</section><section className="space-y-3 rounded-2xl border p-6"><h2 className="text-xl font-semibold">Private documents</h2>{docs.map((doc) => <a key={doc.id} href={`/api/doctor/documents/${doc.id}`} className="block text-primary underline">{doc.type.replaceAll("_", " ")} — {doc.originalName}</a>)}</section><ReviewControls doctorId={id}/></main>;
}
