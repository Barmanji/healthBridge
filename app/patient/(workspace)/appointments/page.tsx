import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appointments, departments, doctorProfiles, patientProfiles, triageAssessments, user } from "@/lib/db/schema";
import { AppointmentList } from "@/modules/patient/appointment-list";

export default async function PatientAppointmentsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "patient") redirect("/sign-in");
  const [profile] = await db.select({ id: patientProfiles.id }).from(patientProfiles).where(eq(patientProfiles.userId, session.user.id)).limit(1);
  if (!profile) redirect("/patient/onboarding");
  const rows = await db.select({
    id: appointments.id,
    status: appointments.status,
    startsAt: appointments.startsAt,
    endsAt: appointments.endsAt,
    holdExpiresAt: appointments.holdExpiresAt,
    consultMode: appointments.consultMode,
    doctorName: doctorProfiles.fullName,
    fallbackDoctorName: user.name,
    department: departments.name,
    timeZone: doctorProfiles.timeZone,
    severity: triageAssessments.severity,
    summary: triageAssessments.summary,
    conversationId: triageAssessments.conversationId,
  }).from(appointments)
    .innerJoin(doctorProfiles, eq(doctorProfiles.id, appointments.doctorId))
    .innerJoin(user, eq(user.id, doctorProfiles.userId))
    .leftJoin(departments, eq(departments.id, doctorProfiles.departmentId))
    .leftJoin(triageAssessments, eq(triageAssessments.id, appointments.triageId))
    .where(eq(appointments.patientId, profile.id))
    .orderBy(desc(appointments.startsAt))
    .limit(100);
  const now = new Date();
  const items = rows.map((row) => {
    // A hold that ran out is not a booking. Derive that once and use it everywhere,
    // otherwise an expired hold still lands in "Upcoming" while the doctor's dashboard
    // (which only lists confirmed visits) shows nothing.
    const status = row.status === "held" && (row.holdExpiresAt === null || row.holdExpiresAt <= now) ? "expired" : row.status;
    return {
      id: row.id,
      status,
      holdExpiresAt: status === "held" ? row.holdExpiresAt?.toISOString() ?? null : null,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      consultMode: row.consultMode,
      doctorName: row.doctorName ?? row.fallbackDoctorName,
      department: row.department,
      timeZone: row.timeZone,
      severity: row.severity,
      summary: row.summary,
      conversationId: row.conversationId,
      section: ["held", "confirmed"].includes(status) && row.startsAt > now ? "upcoming" as const : "history" as const,
    };
  });

  return <main className="mx-auto max-w-4xl space-y-7 px-4 py-8 sm:px-8 sm:py-10">
    <header><p className="text-sm font-semibold text-primary">Your care</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Appointments</h1><p className="mt-2 text-muted-foreground">Review upcoming visits and your booking history.</p></header>
    <AppointmentList appointments={items} />
  </main>;
}
