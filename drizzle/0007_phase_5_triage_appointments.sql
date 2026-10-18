CREATE TYPE "public"."appointment_status" AS ENUM('held', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired', 'declined');--> statement-breakpoint
CREATE TYPE "public"."consult_mode" AS ENUM('video', 'audio');--> statement-breakpoint
CREATE TYPE "public"."triage_severity" AS ENUM('routine', 'soon', 'urgent', 'emergency');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"triage_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "appointment_status" DEFAULT 'held' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"consult_mode" "consult_mode" NOT NULL,
	"confirmed_by_patient_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_range_check" CHECK ("appointments"."starts_at" < "appointments"."ends_at"),
	CONSTRAINT "appointments_hold_check" CHECK (("appointments"."status" = 'held' and "appointments"."hold_expires_at" is not null) or ("appointments"."status" <> 'held' and "appointments"."hold_expires_at" is null)),
	CONSTRAINT "appointments_confirmed_at_check" CHECK (("appointments"."status" = 'confirmed') = ("appointments"."confirmed_by_patient_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "doctor_soap_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"subjective" text DEFAULT '' NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"assessment" text DEFAULT '' NOT NULL,
	"plan" text DEFAULT '' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_soap_notes_appointment_id_unique" UNIQUE("appointment_id")
);
--> statement-breakpoint
CREATE TABLE "triage_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"department_id" uuid,
	"language_code" text NOT NULL,
	"summary" text NOT NULL,
	"severity" "triage_severity" NOT NULL,
	"soap" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_assessments_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patient_profiles_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_triage_id_triage_assessments_id_fk" FOREIGN KEY ("triage_id") REFERENCES "public"."triage_assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_soap_notes" ADD CONSTRAINT "doctor_soap_notes_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_soap_notes" ADD CONSTRAINT "doctor_soap_notes_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_assessments" ADD CONSTRAINT "triage_assessments_patient_id_patient_profiles_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_assessments" ADD CONSTRAINT "triage_assessments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_assessments" ADD CONSTRAINT "triage_assessments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_patient_start_idx" ON "appointments" USING btree ("patient_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_doctor_start_idx" ON "appointments" USING btree ("doctor_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_active_doctor_start_uq" ON "appointments" USING btree ("doctor_id","starts_at") WHERE "appointments"."status" in ('held', 'confirmed');--> statement-breakpoint
CREATE INDEX "doctor_soap_notes_doctor_idx" ON "doctor_soap_notes" USING btree ("doctor_id","updated_at");--> statement-breakpoint
CREATE INDEX "triage_assessments_patient_created_idx" ON "triage_assessments" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "triage_assessments_department_severity_idx" ON "triage_assessments" USING btree ("department_id","severity","created_at");