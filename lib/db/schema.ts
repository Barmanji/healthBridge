import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  uuid,
  integer,
  jsonb,
  time,
  real,
  uniqueIndex,
  pgEnum,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["patient", "doctor", "admin"]);
export const doctorStatusEnum = pgEnum("doctor_verification_status", [
  "draft",
  "submitted",
  "under_review",
  "needs_info",
  "verified",
  "rejected",
]);
export const doctorDocumentTypeEnum = pgEnum("doctor_document_type", [
  "registration_certificate",
  "degree_certificate",
  "government_id",
  "profile_photo",
]);
export const conversationStatusEnum = pgEnum("conversation_status", ["active", "halted", "closed"]);
export const conversationTitleSourceEnum = pgEnum("conversation_title_source", ["auto", "patient"]);
export const conversationMessageRoleEnum = pgEnum("conversation_message_role", ["patient", "assistant", "system"]);
export const conversationModalityEnum = pgEnum("conversation_modality", ["text", "voice"]);
export const riskAssessmentEnum = pgEnum("risk_assessment", ["not_critical", "critical", "needs_human_review"]);
export const triageSeverityEnum = pgEnum("triage_severity", ["routine", "soon", "urgent", "emergency"]);
export const appointmentStatusEnum = pgEnum("appointment_status", ["held", "confirmed", "cancelled", "completed", "no_show", "expired", "declined"]);
export const consultModeEnum = pgEnum("consult_mode", ["video", "audio"]);
export const statementCategoryEnum = pgEnum("statement_category", [
  "symptom",
  "duration",
  "medication",
  "allergy",
  "medical_history",
  "other",
]);
export const statementClassificationStatusEnum = pgEnum("statement_classification_status", [
  "auto",
  "uncertain",
  "corrected",
  "unavailable",
]);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: userRoleEnum("role").default("patient").notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const departments = pgTable("departments", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const patientProfiles = pgTable(
  "patient_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
    preferredLanguage: text("preferred_language").notNull(),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    consentAcceptedAt: timestamp("consent_accepted_at"),
    consentVersion: text("consent_version"),
    onboardingCompletedAt: timestamp("onboarding_completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    index("patient_profiles_language_idx").on(table.preferredLanguage),
    check("patient_profiles_contact_pair_check", sql`(${table.emergencyContactName} is null) = (${table.emergencyContactPhone} is null)`),
    check("patient_profiles_consent_pair_check", sql`(${table.consentAcceptedAt} is null) = (${table.consentVersion} is null)`),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    patientId: uuid("patient_id").notNull().references(() => patientProfiles.id, { onDelete: "cascade" }),
    languageCode: text("language_code").notNull().default("hi-IN"),
    status: conversationStatusEnum("status").notNull().default("active"),
    // Short, recognizable topic for the sidebar. Null until the first turns give
    // the model something to summarize. "patient" means the user renamed it, and
    // an automatic refresh must never overwrite that.
    title: text("title"),
    titleSource: conversationTitleSourceEnum("title_source").notNull().default("auto"),
    titleUpdatedAt: timestamp("title_updated_at"),
    aiProcessingConsentAt: timestamp("ai_processing_consent_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [index("conversations_patient_created_idx").on(table.patientId, table.createdAt)],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    replyToMessageId: uuid("reply_to_message_id"),
    clientMessageId: text("client_message_id"),
    role: conversationMessageRoleEnum("role").notNull(),
    modality: conversationModalityEnum("modality").notNull(),
    languageCode: text("language_code"),
    content: text("content").notNull(),
    contentEnglish: text("content_english"),
    vapiCallId: text("vapi_call_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversation_messages_thread_idx").on(table.conversationId, table.createdAt),
    uniqueIndex("conversation_messages_client_id_uq").on(table.conversationId, table.clientMessageId),
  ],
);

export const riskEvents = pgTable(
  "risk_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => conversationMessages.id, { onDelete: "set null" }),
    assessment: riskAssessmentEnum("assessment").notNull(),
    triggeredBy: text("triggered_by").notNull(),
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    actionTaken: text("action_taken").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("risk_events_conversation_created_idx").on(table.conversationId, table.createdAt)],
);

export const triageAssessments = pgTable(
  "triage_assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    patientId: uuid("patient_id").notNull().references(() => patientProfiles.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull().unique().references(() => conversations.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    languageCode: text("language_code").notNull(),
    summary: text("summary").notNull(),
    severity: triageSeverityEnum("severity").notNull(),
    soap: jsonb("soap").$type<{ subjective: string; objective: string; assessment: string; plan: string }>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("triage_assessments_patient_created_idx").on(table.patientId, table.createdAt),
    index("triage_assessments_department_severity_idx").on(table.departmentId, table.severity, table.createdAt),
  ],
);

export const voiceSessions = pgTable(
  "voice_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    vapiCallId: text("vapi_call_id").unique(),
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("voice_sessions_conversation_expiry_idx").on(table.conversationId, table.expiresAt)],
);

export const doctorProfiles = pgTable(
  "doctor_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
    fullName: text("full_name"),
    phone: text("phone"),
    gender: text("gender"),
    dateOfBirth: timestamp("date_of_birth", { mode: "date" }),
    city: text("city"),
    state: text("state"),
    bio: text("bio"),
    profilePhotoDocumentId: uuid("profile_photo_document_id"),
    registrationNumber: text("registration_number"),
    registrationCouncil: text("registration_council"),
    registrationYear: integer("registration_year"),
    departmentId: uuid("department_id").references(() => departments.id),
    subSpecialties: jsonb("sub_specialties").$type<string[]>().default([]).notNull(),
    qualifications: jsonb("qualifications")
      .$type<Array<{ degree: string; institution: string; year: number }>>()
      .default([])
      .notNull(),
    yearsExperience: integer("years_experience"),
    clinicName: text("clinic_name"),
    clinicAddress: text("clinic_address"),
    languages: jsonb("languages").$type<string[]>().default([]).notNull(),
    consultModes: jsonb("consult_modes").$type<Array<"video" | "audio">>().default([]).notNull(),
    feeInr: integer("fee_inr"),
    timeZone: text("time_zone").default("Asia/Kolkata").notNull(),
    slotMinutes: integer("slot_minutes").default(15).notNull(),
    bufferMinutes: integer("buffer_minutes").default(0).notNull(),
    onboardingStep: integer("onboarding_step").default(1).notNull(),
    verificationStatus: doctorStatusEnum("verification_status").default("draft").notNull(),
    verificationNotes: text("verification_notes"),
    submittedAt: timestamp("submitted_at"),
    verifiedAt: timestamp("verified_at"),
    verifiedByUserId: text("verified_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    index("doctor_profiles_status_idx").on(table.verificationStatus),
    index("doctor_profiles_department_idx").on(table.departmentId),
    check("doctor_profiles_step_check", sql`${table.onboardingStep} between 1 and 7`),
    check("doctor_profiles_year_check", sql`${table.registrationYear} is null or ${table.registrationYear} between 1900 and 2100`),
    check("doctor_profiles_experience_check", sql`${table.yearsExperience} is null or ${table.yearsExperience} between 0 and 80`),
    check("doctor_profiles_fee_check", sql`${table.feeInr} is null or ${table.feeInr} between 0 and 1000000`),
    check("doctor_profiles_slot_check", sql`${table.slotMinutes} between 5 and 240`),
    check("doctor_profiles_buffer_check", sql`${table.bufferMinutes} between 0 and 120`),
  ],
);

export const doctorDocuments = pgTable(
  "doctor_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    doctorId: uuid("doctor_id").notNull().references(() => doctorProfiles.id, { onDelete: "cascade" }),
    type: doctorDocumentTypeEnum("type").notNull(),
    objectKey: text("object_key").notNull().unique(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (table) => [
    index("doctor_documents_doctor_idx").on(table.doctorId),
    check("doctor_documents_size_check", sql`${table.sizeBytes} between 1 and 10485760`),
  ],
);

export const doctorAvailabilityRules = pgTable(
  "doctor_availability_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    doctorId: uuid("doctor_id").notNull().references(() => doctorProfiles.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("doctor_availability_doctor_idx").on(table.doctorId),
    uniqueIndex("doctor_availability_rule_uq").on(table.doctorId, table.weekday, table.startTime, table.endTime),
    check("doctor_availability_weekday_check", sql`${table.weekday} between 0 and 6`),
    check("doctor_availability_time_check", sql`${table.startTime} < ${table.endTime}`),
  ],
);

export const doctorTimeOff = pgTable(
  "doctor_time_off",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    doctorId: uuid("doctor_id").notNull().references(() => doctorProfiles.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("doctor_time_off_doctor_idx").on(table.doctorId, table.startsAt),
    check("doctor_time_off_range_check", sql`${table.startsAt} < ${table.endsAt}`),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    patientId: uuid("patient_id").notNull().references(() => patientProfiles.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id").notNull().references(() => doctorProfiles.id, { onDelete: "restrict" }),
    triageId: uuid("triage_id").references(() => triageAssessments.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatusEnum("status").default("held").notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    consultMode: consultModeEnum("consult_mode").notNull(),
    confirmedByPatientAt: timestamp("confirmed_by_patient_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    index("appointments_patient_start_idx").on(table.patientId, table.startsAt),
    index("appointments_doctor_start_idx").on(table.doctorId, table.startsAt),
    uniqueIndex("appointments_active_doctor_start_uq").on(table.doctorId, table.startsAt).where(sql`${table.status} in ('held', 'confirmed')`),
    check("appointments_range_check", sql`${table.startsAt} < ${table.endsAt}`),
    check("appointments_hold_check", sql`(${table.status} = 'held' and ${table.holdExpiresAt} is not null) or (${table.status} <> 'held' and ${table.holdExpiresAt} is null)`),
    check("appointments_confirmed_at_check", sql`${table.status} <> 'confirmed' or ${table.confirmedByPatientAt} is not null`),
  ],
);

export const doctorSoapNotes = pgTable(
  "doctor_soap_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appointmentId: uuid("appointment_id").notNull().unique().references(() => appointments.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id").notNull().references(() => doctorProfiles.id, { onDelete: "cascade" }),
    subjective: text("subjective").notNull().default(""),
    objective: text("objective").notNull().default(""),
    assessment: text("assessment").notNull().default(""),
    plan: text("plan").notNull().default(""),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [index("doctor_soap_notes_doctor_idx").on(table.doctorId, table.updatedAt)],
);

/**
 * Experimental ML aid (see ML.md). The statement classifier labels each patient
 * statement with a documentation category so a clinician can review an intake
 * faster. These rows are never used for emergency detection or severity, and the
 * original statement is always preserved verbatim.
 */
export const statementClassifications = pgTable(
  "statement_classifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id").notNull().references(() => conversationMessages.id, { onDelete: "cascade" }),
    statementIndex: integer("statement_index").notNull(),
    statement: text("statement").notNull(),
    languageCode: text("language_code"),
    modelVersion: text("model_version"),
    predictedCategory: statementCategoryEnum("predicted_category"),
    confidence: real("confidence"),
    status: statementClassificationStatusEnum("status").notNull().default("auto"),
    correctedCategory: statementCategoryEnum("corrected_category"),
    correctedByUserId: text("corrected_by_user_id").references(() => user.id, { onDelete: "set null" }),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("statement_classifications_message_idx_uq").on(table.messageId, table.statementIndex),
    index("statement_classifications_message_idx").on(table.messageId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    meta: jsonb("meta").$type<Record<string, string | number | boolean | null>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("audit_logs_entity_idx").on(table.entity, table.entityId)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  doctorProfiles: many(doctorProfiles),
}));

export const patientProfileRelations = relations(patientProfiles, ({ one, many }) => ({
  user: one(user, { fields: [patientProfiles.userId], references: [user.id] }),
  conversations: many(conversations),
}));

export const conversationRelations = relations(conversations, ({ one, many }) => ({
  patient: one(patientProfiles, { fields: [conversations.patientId], references: [patientProfiles.id] }),
  messages: many(conversationMessages),
  riskEvents: many(riskEvents),
  voiceSessions: many(voiceSessions),
}));

export const voiceSessionRelations = relations(voiceSessions, ({ one }) => ({
  conversation: one(conversations, { fields: [voiceSessions.conversationId], references: [conversations.id] }),
}));

export const conversationMessageRelations = relations(conversationMessages, ({ one }) => ({
  conversation: one(conversations, { fields: [conversationMessages.conversationId], references: [conversations.id] }),
}));

export const riskEventRelations = relations(riskEvents, ({ one }) => ({
  conversation: one(conversations, { fields: [riskEvents.conversationId], references: [conversations.id] }),
  message: one(conversationMessages, { fields: [riskEvents.messageId], references: [conversationMessages.id] }),
}));

export const doctorProfileRelations = relations(doctorProfiles, ({ one, many }) => ({
  user: one(user, { fields: [doctorProfiles.userId], references: [user.id] }),
  department: one(departments, { fields: [doctorProfiles.departmentId], references: [departments.id] }),
  documents: many(doctorDocuments),
  availabilityRules: many(doctorAvailabilityRules),
  timeOff: many(doctorTimeOff),
}));

export const doctorDocumentRelations = relations(doctorDocuments, ({ one }) => ({
  doctor: one(doctorProfiles, { fields: [doctorDocuments.doctorId], references: [doctorProfiles.id] }),
}));

export const doctorAvailabilityRelations = relations(doctorAvailabilityRules, ({ one }) => ({
  doctor: one(doctorProfiles, { fields: [doctorAvailabilityRules.doctorId], references: [doctorProfiles.id] }),
}));

export const doctorTimeOffRelations = relations(doctorTimeOff, ({ one }) => ({
  doctor: one(doctorProfiles, { fields: [doctorTimeOff.doctorId], references: [doctorProfiles.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
