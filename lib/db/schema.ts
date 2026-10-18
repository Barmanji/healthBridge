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
