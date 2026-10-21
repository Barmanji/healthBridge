import { z } from "zod";

export const patientLanguages = [
  { code: "en-IN", name: "English" },
  { code: "hi-IN", name: "हिन्दी" },
  { code: "bn-IN", name: "বাংলা" },
  { code: "mr-IN", name: "मराठी" },
  { code: "te-IN", name: "తెలుగు" },
  { code: "ta-IN", name: "தமிழ்" },
  { code: "gu-IN", name: "ગુજરાતી" },
  { code: "kn-IN", name: "ಕನ್ನಡ" },
  { code: "ml-IN", name: "മലയാളം" },
  { code: "pa-IN", name: "ਪੰਜਾਬੀ" },
  { code: "or-IN", name: "ଓଡ଼ିଆ" },
  { code: "as-IN", name: "অসমীয়া" },
  { code: "ur-IN", name: "اردو" },
] as const;

const patientLanguageCodes = patientLanguages.map(({ code }) => code) as [string, ...string[]];

const patientNameSchema = z.string().trim().min(2, "Name must have at least 2 characters.").max(80, "Name must be 80 characters or fewer.");

const patientDetailsShape = {
  name: patientNameSchema,
  preferredLanguage: z.enum(patientLanguageCodes, { error: "Choose a language from the list." }),
  emergencyContactName: z.string().trim().max(80, "Contact name must be 80 characters or fewer.").default(""),
  emergencyContactPhone: z.string().trim().max(32, "Phone number must be 32 characters or fewer.").default(""),
};

const validateEmergencyContact = (values: { emergencyContactName: string; emergencyContactPhone: string }, ctx: z.RefinementCtx) => {
  const hasName = values.emergencyContactName.length > 0;
  const hasPhone = values.emergencyContactPhone.length > 0;
  if (hasName !== hasPhone) {
    ctx.addIssue({ code: "custom", path: [hasName ? "emergencyContactPhone" : "emergencyContactName"], message: "Enter both emergency contact fields, or leave both blank." });
  }
  if (hasPhone && !/^(?:\+?[1-9]\d{7,14}|[6-9]\d{9})$/.test(values.emergencyContactPhone.replace(/[\s()-]/g, ""))) {
    ctx.addIssue({ code: "custom", path: ["emergencyContactPhone"], message: "Enter a valid phone number, including country code if needed." });
  }
};

export const patientProfileSchema = z.object(patientDetailsShape).superRefine(validateEmergencyContact);

export const patientOnboardingSchema = z.object({
  ...patientDetailsShape,
  consent: z.literal(true, { error: "Consent is required to save this profile." }),
}).superRefine(validateEmergencyContact);

export const createConversationSchema = z.object({
  aiProcessingConsent: z.literal(true, { error: "Consent is required to start an AI conversation." }),
});

export const conversationTitleSchema = z.object({
  conversationId: z.uuid(),
  title: z.string().trim().min(2, "Use at least 2 characters.").max(60, "Titles must be 60 characters or fewer."),
});

export const conversationMessageSchema = z.object({
  clientMessageId: z.uuid(),
  content: z.string().trim().min(1, "Write or say a message first.").max(1800, "Messages must be 1,800 characters or fewer."),
  modality: z.enum(["text", "voice"]),
  languageCode: z.string().trim().min(2).max(35).default("hi-IN"),
  vapiCallId: z.string().trim().min(1).max(128).optional(),
});
