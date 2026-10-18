import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { departments, doctorProfiles, user } from "@/lib/db/schema";
import { DoctorDirectoryResults } from "@/modules/patient/doctor-directory-results";

type DoctorSearchProps = { searchParams: Promise<{ q?: string; city?: string; department?: string }> };

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export default async function DoctorSearchPage({ searchParams }: DoctorSearchProps) {
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 80) ?? "";
  const city = params.city?.trim().slice(0, 80) ?? "";
  const departmentId = params.department && /^[0-9a-f-]{36}$/i.test(params.department) ? params.department : "";
  const filters = [eq(doctorProfiles.verificationStatus, "verified")];
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    filters.push(or(ilike(user.name, pattern), ilike(doctorProfiles.fullName, pattern), ilike(departments.name, pattern), ilike(doctorProfiles.bio, pattern))!);
  }
  if (city) {
    const pattern = `%${escapeLike(city)}%`;
    filters.push(or(ilike(doctorProfiles.city, pattern), ilike(doctorProfiles.state, pattern))!);
  }
  if (departmentId) filters.push(eq(doctorProfiles.departmentId, departmentId));

  const [doctors, departmentOptions] = await Promise.all([
    db.select({ id: doctorProfiles.id, name: sql<string>`coalesce(${doctorProfiles.fullName}, ${user.name})`, bio: doctorProfiles.bio, department: departments.name, city: doctorProfiles.city, state: doctorProfiles.state, languages: doctorProfiles.languages, consultModes: doctorProfiles.consultModes, yearsExperience: doctorProfiles.yearsExperience, feeInr: doctorProfiles.feeInr })
      .from(doctorProfiles)
      .innerJoin(user, eq(user.id, doctorProfiles.userId))
      .leftJoin(departments, eq(departments.id, doctorProfiles.departmentId))
      .where(and(...filters))
      .orderBy(desc(doctorProfiles.verifiedAt))
      .limit(60),
    db.select({ id: departments.id, name: departments.name }).from(departments).orderBy(departments.name),
  ]);

  return <main className="mx-auto max-w-7xl space-y-7 px-4 py-8 sm:px-8 sm:py-10">
    <header><p className="text-sm font-semibold text-primary">Doctor directory</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Find care that fits you</h1><p className="mt-2 text-muted-foreground">Browse clinicians whose credentials have been reviewed by Health-Bridge.</p></header>
    <form method="get" className="grid gap-3 rounded-2xl border bg-card p-4 md:grid-cols-[1fr_0.7fr_0.7fr_auto]">
      <label className="grid gap-1.5 text-sm font-medium">Doctor or specialty<input name="q" maxLength={80} defaultValue={query} placeholder="Name, specialty, or keyword" className="h-11 rounded-xl border bg-background px-3 font-normal" /></label>
      <label className="grid gap-1.5 text-sm font-medium">City or state<input name="city" maxLength={80} defaultValue={city} placeholder="e.g. Pune" className="h-11 rounded-xl border bg-background px-3 font-normal" /></label>
      <label className="grid gap-1.5 text-sm font-medium">Specialty<select name="department" defaultValue={departmentId} className="h-11 rounded-xl border bg-background px-3 font-normal"><option value="">All specialties</option>{departmentOptions.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
      <button className="min-h-11 self-end rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">Search</button>
    </form>
    <DoctorDirectoryResults doctors={doctors} />
  </main>;
}
