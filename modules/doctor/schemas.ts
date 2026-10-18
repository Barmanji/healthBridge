import { z } from "zod";

const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);

const optionalText = (max: number) =>
  z.string().trim().max(max, `Must be ${max} characters or fewer.`).optional().or(z.literal(""));

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid date.");

const timeZone = z.string().min(1).max(100).refine((value) => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Choose a valid time zone.");

export const personalStepSchema = z.object({
  fullName: requiredText("Full name", 120),
  phone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, "Enter a valid phone number with country code."),
  gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say"]).optional().or(z.literal("")),
  dateOfBirth: dateOnly.optional().or(z.literal("")),
  city: requiredText("City", 100),
  state: requiredText("State", 100),
  bio: optionalText(1000),
});

const qualificationSchema = z.object({
  degree: requiredText("Degree", 120),
  institution: requiredText("Institution", 180),
  year: z.coerce.number().int().min(1900).max(new Date().getFullYear()),
});

export const professionalStepSchema = z.object({
  registrationNumber: requiredText("Registration number", 100),
  registrationCouncil: requiredText("Medical council", 180),
  registrationYear: z.coerce.number().int().min(1900).max(new Date().getFullYear()),
  departmentId: z.string().uuid("Choose a specialization."),
  subSpecialties: z.array(z.string().trim().min(1).max(80)).max(10).refine((values) => new Set(values.map((value) => value.toLowerCase())).size === values.length, "Remove duplicate sub-specialties."),
  qualifications: z.array(qualificationSchema).min(1).max(10),
  yearsExperience: z.coerce.number().int().min(0).max(80),
});

export const practiceStepSchema = z.object({
  clinicName: optionalText(160),
  clinicAddress: optionalText(500),
  languages: z.array(z.string().trim().min(2).max(35)).min(1, "Add at least one language.").max(12).refine((values) => new Set(values.map((value) => value.toLowerCase())).size === values.length, "Remove duplicate languages."),
  consultModes: z.array(z.enum(["video", "audio"])).min(1, "Choose at least one consultation mode.").refine((values) => new Set(values).size === values.length, "Remove duplicate consultation modes."),
  feeInr: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const availabilityRuleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid start time."),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid end time."),
}).refine((value) => value.startTime < value.endTime, {
  message: "End time must be after start time.",
  path: ["endTime"],
});

const timeOffSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  reason: optionalText(240),
}).refine((value) => Date.parse(value.startsAt) < Date.parse(value.endsAt), {
  message: "Leave must end after it starts.",
  path: ["endsAt"],
});

export const availabilityStepSchema = z.object({
  timeZone,
  slotMinutes: z.number().int().min(5).max(240).multipleOf(5),
  bufferMinutes: z.number().int().min(0).max(120),
  weeklySchedule: z.array(availabilityRuleSchema).max(21),
  plannedLeave: z.array(timeOffSchema).max(20),
}).superRefine((value, context) => {
  const seen = new Set<string>();
  for (const [index, rule] of value.weeklySchedule.entries()) {
    const key = `${rule.weekday}:${rule.startTime}:${rule.endTime}`;
    if (seen.has(key)) {
      context.addIssue({ code: "custom", message: "Remove duplicate availability periods.", path: ["weeklySchedule", index] });
    }
    seen.add(key);
  }

  for (let first = 0; first < value.weeklySchedule.length; first += 1) {
    for (let second = first + 1; second < value.weeklySchedule.length; second += 1) {
      const a = value.weeklySchedule[first];
      const b = value.weeklySchedule[second];
      if (a.weekday === b.weekday && a.startTime < b.endTime && b.startTime < a.endTime) {
        context.addIssue({ code: "custom", message: "Availability periods on the same day cannot overlap.", path: ["weeklySchedule", second] });
      }
    }
  }
});

export const submitApplicationSchema = z.object({
  acceptedTerms: z.literal(true, "Accept the terms to submit your application."),
  acceptedDataProcessing: z.literal(true, "Consent to data processing to submit your application."),
  acceptedTelemedicineDeclaration: z.literal(true, "Accept the telemedicine declaration to submit your application."),
});

export const reviewDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("start_review"), doctorId: z.string().uuid() }),
  z.object({ decision: z.literal("approve"), doctorId: z.string().uuid() }),
  z.object({ decision: z.literal("request_info"), doctorId: z.string().uuid(), message: requiredText("Message", 1000) }),
  z.object({ decision: z.literal("reject"), doctorId: z.string().uuid(), reason: requiredText("Reason", 1000) }),
]);

export type PersonalStepValues = z.infer<typeof personalStepSchema>;
export type ProfessionalStepValues = z.infer<typeof professionalStepSchema>;
export type PracticeStepValues = z.infer<typeof practiceStepSchema>;
export type AvailabilityStepValues = z.infer<typeof availabilityStepSchema>;
