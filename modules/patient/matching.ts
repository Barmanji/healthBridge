import { and, eq, gte, gt, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { appointments, departments, doctorAvailabilityRules, doctorProfiles, doctorTimeOff, user } from "@/lib/db/schema";
import { generateAvailableSlots } from "@/lib/appointments/scheduling";
import { patientLanguages } from "@/modules/patient/schemas";

export type DoctorSuggestion = {
  doctorId: string;
  name: string;
  department: string | null;
  city: string | null;
  state: string | null;
  languages: string[];
  consultModes: Array<"video" | "audio">;
  yearsExperience: number | null;
  slotMinutes: number;
  timeZone: string;
  slots: Array<{ startsAt: string; endsAt: string }>;
  why: string[];
};

function hasLanguage(languages: string[], code: string) {
  const language = patientLanguages.find((item) => item.code.toLowerCase() === code.toLowerCase());
  const values = [code, code.split("-")[0], language?.name ?? ""]
    .filter(Boolean).map((value) => value.toLowerCase());
  return languages.some((item) => {
    const normalized = item.trim().toLowerCase();
    return values.some((value) => normalized === value || normalized.startsWith(`${value}-`));
  });
}

export async function findDoctorSuggestions(input: {
  departmentId: string | null;
  languageCode: string;
  now?: Date;
}): Promise<DoctorSuggestion[]> {
  const now = input.now ?? new Date();
  const horizon = new Date(now.getTime() + 15 * 86_400_000);
  const candidates = await db.select({
    id: doctorProfiles.id,
    name: sql<string>`coalesce(${doctorProfiles.fullName}, ${user.name})`,
    departmentId: doctorProfiles.departmentId,
    department: departments.name,
    city: doctorProfiles.city,
    state: doctorProfiles.state,
    languages: doctorProfiles.languages,
    consultModes: doctorProfiles.consultModes,
    yearsExperience: doctorProfiles.yearsExperience,
    timeZone: doctorProfiles.timeZone,
    slotMinutes: doctorProfiles.slotMinutes,
    bufferMinutes: doctorProfiles.bufferMinutes,
  }).from(doctorProfiles)
    .innerJoin(user, eq(user.id, doctorProfiles.userId))
    .leftJoin(departments, eq(departments.id, doctorProfiles.departmentId))
    .where(eq(doctorProfiles.verificationStatus, "verified"))
    .limit(40);

  const viable = candidates.filter((doctor) => doctor.consultModes.length > 0).sort((a, b) => {
    const score = (doctor: typeof candidates[number]) =>
      (input.departmentId && doctor.departmentId === input.departmentId ? 100 : 0) +
      (hasLanguage(doctor.languages, input.languageCode) ? 30 : 0);
    return score(b) - score(a) || (b.yearsExperience ?? 0) - (a.yearsExperience ?? 0);
  });
  const candidateIds = viable.map((doctor) => doctor.id);
  if (!candidateIds.length) return [];
  const [allRules, allLeave, allBooked] = await Promise.all([
    db.select({ doctorId: doctorAvailabilityRules.doctorId, weekday: doctorAvailabilityRules.weekday, startTime: doctorAvailabilityRules.startTime, endTime: doctorAvailabilityRules.endTime })
      .from(doctorAvailabilityRules).where(inArray(doctorAvailabilityRules.doctorId, candidateIds)),
    db.select({ doctorId: doctorTimeOff.doctorId, startsAt: doctorTimeOff.startsAt, endsAt: doctorTimeOff.endsAt })
      .from(doctorTimeOff).where(and(inArray(doctorTimeOff.doctorId, candidateIds), lt(doctorTimeOff.startsAt, horizon), gte(doctorTimeOff.endsAt, now))),
    db.select({ doctorId: appointments.doctorId, startsAt: appointments.startsAt, endsAt: appointments.endsAt })
      .from(appointments).where(and(
        inArray(appointments.doctorId, candidateIds),
        or(eq(appointments.status, "confirmed"), and(eq(appointments.status, "held"), gt(appointments.holdExpiresAt, now))),
        lt(appointments.startsAt, horizon),
        gte(appointments.endsAt, now),
      )),
  ]);

  const results: DoctorSuggestion[] = [];
  for (const doctor of viable) {
    let slots;
    try {
      slots = generateAvailableSlots({
        rules: allRules.filter((rule) => rule.doctorId === doctor.id),
        timeOff: allLeave.filter((period) => period.doctorId === doctor.id),
        booked: allBooked.filter((period) => period.doctorId === doctor.id),
        timeZone: doctor.timeZone,
        slotMinutes: doctor.slotMinutes,
        bufferMinutes: doctor.bufferMinutes,
        now,
        horizonDays: 14,
        // Keep a full two-week calendar for the expanded date/time picker. The UI
        // still shows only the first three recommended slots until expanded.
        limit: 1000,
      });
    } catch {
      // Invalid legacy time-zone values are excluded from matching until corrected by the doctor.
      continue;
    }
    if (!slots.length) continue;
    const languageMatch = hasLanguage(doctor.languages, input.languageCode);
    const departmentMatch = Boolean(input.departmentId && doctor.departmentId === input.departmentId);
    results.push({
      doctorId: doctor.id,
      name: doctor.name,
      department: doctor.department,
      city: doctor.city,
      state: doctor.state,
      languages: doctor.languages,
      consultModes: doctor.consultModes,
      yearsExperience: doctor.yearsExperience,
      slotMinutes: doctor.slotMinutes,
      timeZone: doctor.timeZone,
      slots: slots.map((slot) => ({ startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() })),
      why: [
        ...(departmentMatch ? ["Matches the suggested specialty"] : []),
        ...(languageMatch ? ["Speaks your conversation language"] : []),
        "Has an available appointment time",
      ],
    });
    if (results.length === 3) break;
  }
  return results;
}
