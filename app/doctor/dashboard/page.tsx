import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appointments, conversationMessages, doctorAvailabilityRules, doctorProfiles, doctorSoapNotes, doctorTimeOff, patientProfiles, statementClassifications, triageAssessments, user } from "@/lib/db/schema";
import { correctStatementCategory, saveDoctorSoapNote, updateDoctorAppointmentOutcome } from "@/modules/doctor/actions";

export default async function DoctorDashboardPage({ searchParams }: { searchParams: Promise<{ status?: string; mode?: string }> }) {
  const params = await searchParams;
  const statusFilter = ["completed", "no_show", "all"].includes(params.status ?? "") ? params.status! : "upcoming";
  const modeFilter = params.mode === "audio" || params.mode === "video" ? params.mode : "all";
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "doctor") redirect("/");
  const [profile] = await db.select().from(doctorProfiles).where(eq(doctorProfiles.userId, session.user.id)).limit(1);
  if (!profile || profile.verificationStatus !== "verified") redirect("/doctor/onboarding");
  const [schedule, leave] = await Promise.all([
    db.select().from(doctorAvailabilityRules).where(eq(doctorAvailabilityRules.doctorId, profile.id)),
    db.select().from(doctorTimeOff).where(eq(doctorTimeOff.doctorId, profile.id)),
  ]);
  const queueFilters = [eq(appointments.doctorId, profile.id), inArray(appointments.status,
    statusFilter === "upcoming" ? ["confirmed"] : statusFilter === "all" ? ["confirmed", "completed", "no_show"] : [statusFilter as "completed" | "no_show"],
  )];
  if (modeFilter !== "all") queueFilters.push(eq(appointments.consultMode, modeFilter));
  const queue = await db.select({
    id: appointments.id,
    status: appointments.status,
    startsAt: appointments.startsAt,
    endsAt: appointments.endsAt,
    mode: appointments.consultMode,
    patientName: user.name,
    language: patientProfiles.preferredLanguage,
    severity: triageAssessments.severity,
    summary: triageAssessments.summary,
    triageSoap: triageAssessments.soap,
    triageConversationId: triageAssessments.conversationId,
    noteSubjective: doctorSoapNotes.subjective,
    noteObjective: doctorSoapNotes.objective,
    noteAssessment: doctorSoapNotes.assessment,
    notePlan: doctorSoapNotes.plan,
    reviewedAt: doctorSoapNotes.reviewedAt,
  }).from(appointments)
    .innerJoin(patientProfiles, eq(patientProfiles.id, appointments.patientId))
    .innerJoin(user, eq(user.id, patientProfiles.userId))
    .leftJoin(triageAssessments, eq(triageAssessments.id, appointments.triageId))
    .leftJoin(doctorSoapNotes, eq(doctorSoapNotes.appointmentId, appointments.id))
    .where(and(...queueFilters))
    .orderBy(sql`case ${triageAssessments.severity} when 'urgent' then 0 when 'soon' then 1 when 'routine' then 2 else 3 end`, asc(appointments.startsAt))
    .limit(50);

  // Experimental ML aid (ML.md §4.3). Statements are shown verbatim so the clinician can
  // always see the original text; the category is only a suggestion they can correct.
  const conversationIds = queue.map((visit) => visit.triageConversationId).filter((id): id is string => Boolean(id));
  const statements = conversationIds.length
    ? await db.select({
        id: statementClassifications.id,
        conversationId: conversationMessages.conversationId,
        statement: statementClassifications.statement,
        category: statementClassifications.predictedCategory,
        correctedCategory: statementClassifications.correctedCategory,
        confidence: statementClassifications.confidence,
        status: statementClassifications.status,
        modelVersion: statementClassifications.modelVersion,
      })
        .from(statementClassifications)
        .innerJoin(conversationMessages, eq(conversationMessages.id, statementClassifications.messageId))
        .where(inArray(conversationMessages.conversationId, conversationIds))
        .orderBy(asc(statementClassifications.createdAt), asc(statementClassifications.statementIndex))
        .limit(400)
    : [];
  const statementsByConversation = new Map<string, typeof statements>();
  for (const row of statements) {
    const bucket = statementsByConversation.get(row.conversationId) ?? [];
    bucket.push(row);
    statementsByConversation.set(row.conversationId, bucket);
  }
  const categoryLabels: Record<string, string> = {
    symptom: "Symptom", duration: "Duration", medication: "Medication",
    allergy: "Allergy", medical_history: "Medical history", other: "Other context",
  };
  return <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-8 sm:py-10">
    <header><p className="text-sm font-semibold text-primary">Doctor workspace</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome, {profile.fullName}</h1><p className="mt-2 text-muted-foreground">Appointments are limited to patients who have confirmed a visit with you.</p></header>
    <section className="grid gap-4 sm:grid-cols-3"><article className="rounded-2xl border bg-card p-5"><p className="text-sm text-muted-foreground">Verification</p><p className="mt-2 font-semibold">Verified</p></article><article className="rounded-2xl border bg-card p-5"><p className="text-sm text-muted-foreground">Weekly availability blocks</p><p className="mt-2 font-semibold">{schedule.length}</p></article><article className="rounded-2xl border bg-card p-5"><p className="text-sm text-muted-foreground">Planned time off</p><p className="mt-2 font-semibold">{leave.length}</p></article></section>
    <section className="space-y-4"><div><h2 className="text-2xl font-semibold">Appointments and patient queue</h2><p className="mt-1 text-sm text-muted-foreground">Higher triage urgency is listed first; appointment time breaks ties.</p></div>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4"><label className="grid gap-1 text-sm">Status<select name="status" defaultValue={statusFilter} className="h-10 rounded-lg border bg-background px-3"><option value="upcoming">Upcoming / confirmed</option><option value="completed">Completed</option><option value="no_show">No-show</option><option value="all">All</option></select></label><label className="grid gap-1 text-sm">Mode<select name="mode" defaultValue={modeFilter} className="h-10 rounded-lg border bg-background px-3"><option value="all">All modes</option><option value="video">Video</option><option value="audio">Audio</option></select></label><button className="h-10 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">Apply filters</button></form>
      {queue.length ? queue.map((visit) => {
        const soap = visit.triageSoap;
        return <article key={visit.id} className="space-y-4 rounded-2xl border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{visit.patientName}</h3><p className="mt-1 text-sm text-muted-foreground">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: profile.timeZone }).format(visit.startsAt)} · {visit.mode} · {visit.language} · {visit.status.replaceAll("_", " ")}</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{visit.severity ?? "appointment"}</span></div>
          {visit.summary && <div className="rounded-xl bg-muted/50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI intake summary · clinician review required</p><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{visit.summary}</p></div>}
          {(() => {
            // Experimental ML aid (ML.md §4.3). Statements are always shown verbatim; the
            // category is a suggestion the clinician can correct, never a diagnosis.
            const rows = visit.triageConversationId ? statementsByConversation.get(visit.triageConversationId) ?? [] : [];
            if (!rows.length) return null;
            return <details className="rounded-xl border p-4">
              <summary className="cursor-pointer font-semibold">Patient statements <span className="font-normal text-muted-foreground">· {rows.length} categorised by a local model · experimental, not a diagnosis</span></summary>
              <ul className="mt-4 space-y-3">
                {rows.map((row) => {
                  const effective = row.correctedCategory ?? row.category;
                  return <li key={row.id} className="grid gap-2 border-t pt-3 first:border-t-0 first:pt-0">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{row.statement}</p>
                    <form action={correctStatementCategory} className="flex flex-wrap items-center gap-2 text-xs">
                      <input type="hidden" name="classificationId" value={row.id} />
                      <input type="hidden" name="appointmentId" value={visit.id} />
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${row.status === "corrected" ? "bg-primary/10 text-primary" : row.status === "uncertain" ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground"}`}>
                        {row.correctedCategory ? "corrected" : row.status}
                      </span>
                      <select name="category" defaultValue={effective ?? "other"} className="h-8 rounded-lg border bg-background px-2">
                        {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      {row.confidence !== null && <span className="text-muted-foreground">confidence {row.confidence.toFixed(2)}</span>}
                      <button className="h-8 rounded-full border px-3 font-semibold">Save category</button>
                    </form>
                  </li>;
                })}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">Categories only describe the type of information the patient gave. They never record a diagnosis, severity, or emergency status.</p>
            </details>;
          })()}
          {visit.status !== "no_show" && <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">SOAP note {visit.reviewedAt ? "· reviewed" : "· review needed"}</summary>
            <form action={saveDoctorSoapNote} className="mt-4 grid gap-3">
              <input type="hidden" name="appointmentId" value={visit.id} />
              <label className="grid gap-1 text-sm font-medium">Subjective<textarea name="subjective" maxLength={4000} defaultValue={visit.noteSubjective ?? soap?.subjective ?? ""} className="min-h-20 rounded-xl border bg-background p-3 font-normal" /></label>
              <label className="grid gap-1 text-sm font-medium">Objective<textarea name="objective" maxLength={3000} defaultValue={visit.noteObjective ?? soap?.objective ?? "Not assessed in chat"} className="min-h-20 rounded-xl border bg-background p-3 font-normal" /></label>
              <label className="grid gap-1 text-sm font-medium">Assessment<textarea name="assessment" maxLength={4000} defaultValue={visit.noteAssessment ?? soap?.assessment ?? ""} className="min-h-20 rounded-xl border bg-background p-3 font-normal" /></label>
              <label className="grid gap-1 text-sm font-medium">Plan<textarea name="plan" maxLength={4000} defaultValue={visit.notePlan ?? soap?.plan ?? ""} className="min-h-20 rounded-xl border bg-background p-3 font-normal" /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reviewed" defaultChecked={Boolean(visit.reviewedAt)} /> I reviewed this note</label>
              <button className="min-h-10 w-fit rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">Save SOAP note</button>
            </form>
          </details>}
          {visit.status === "confirmed" && visit.endsAt <= new Date() && <form action={updateDoctorAppointmentOutcome} className="flex flex-wrap gap-2"><input type="hidden" name="appointmentId" value={visit.id} /><button name="outcome" value="completed" className="min-h-10 rounded-full border px-4 text-sm">Mark completed</button>{visit.startsAt <= new Date() && <button name="outcome" value="no_show" className="min-h-10 rounded-full border px-4 text-sm">Mark no-show</button>}</form>}
        </article>;
      }) : <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">No confirmed appointments yet. Patients appear here after they confirm a time.</p>}
    </section>
    <section className="rounded-2xl border bg-card p-5"><h2 className="font-semibold">Your public profile</h2><p className="mt-2 text-sm text-muted-foreground">{profile.departmentId ? "Specialization is on file." : "Add a specialization from onboarding."} · {[profile.city, profile.state].filter(Boolean).join(", ")}</p></section>
  </main>;
}
