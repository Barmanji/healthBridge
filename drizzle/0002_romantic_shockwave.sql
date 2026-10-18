CREATE TYPE "public"."doctor_document_type" AS ENUM('registration_certificate', 'degree_certificate', 'government_id', 'profile_photo');--> statement-breakpoint
CREATE TYPE "public"."doctor_verification_status" AS ENUM('draft', 'submitted', 'under_review', 'needs_info', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('patient', 'doctor', 'admin');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name"),
	CONSTRAINT "departments_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "doctor_availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_availability_weekday_check" CHECK ("doctor_availability_rules"."weekday" between 0 and 6),
	CONSTRAINT "doctor_availability_time_check" CHECK ("doctor_availability_rules"."start_time" < "doctor_availability_rules"."end_time")
);
--> statement-breakpoint
CREATE TABLE "doctor_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"type" "doctor_document_type" NOT NULL,
	"object_key" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_documents_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "doctor_documents_size_check" CHECK ("doctor_documents"."size_bytes" between 1 and 10485760)
);
--> statement-breakpoint
CREATE TABLE "doctor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"full_name" text,
	"phone" text,
	"gender" text,
	"date_of_birth" timestamp,
	"city" text,
	"state" text,
	"bio" text,
	"profile_photo_document_id" uuid,
	"registration_number" text,
	"registration_council" text,
	"registration_year" integer,
	"department_id" uuid,
	"sub_specialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"qualifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"years_experience" integer,
	"clinic_name" text,
	"clinic_address" text,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consult_modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fee_inr" integer,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"slot_minutes" integer DEFAULT 15 NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"onboarding_step" integer DEFAULT 1 NOT NULL,
	"verification_status" "doctor_verification_status" DEFAULT 'draft' NOT NULL,
	"verification_notes" text,
	"submitted_at" timestamp,
	"verified_at" timestamp,
	"verified_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "doctor_profiles_step_check" CHECK ("doctor_profiles"."onboarding_step" between 1 and 7),
	CONSTRAINT "doctor_profiles_year_check" CHECK ("doctor_profiles"."registration_year" is null or "doctor_profiles"."registration_year" between 1900 and 2100),
	CONSTRAINT "doctor_profiles_experience_check" CHECK ("doctor_profiles"."years_experience" is null or "doctor_profiles"."years_experience" between 0 and 80),
	CONSTRAINT "doctor_profiles_fee_check" CHECK ("doctor_profiles"."fee_inr" is null or "doctor_profiles"."fee_inr" between 0 and 1000000),
	CONSTRAINT "doctor_profiles_slot_check" CHECK ("doctor_profiles"."slot_minutes" between 5 and 240),
	CONSTRAINT "doctor_profiles_buffer_check" CHECK ("doctor_profiles"."buffer_minutes" between 0 and 120)
);
--> statement-breakpoint
CREATE TABLE "doctor_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_time_off_range_check" CHECK ("doctor_time_off"."starts_at" < "doctor_time_off"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'patient'::"public"."user_role";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_availability_rules" ADD CONSTRAINT "doctor_availability_rules_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_documents" ADD CONSTRAINT "doctor_documents_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_verified_by_user_id_user_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_time_off" ADD CONSTRAINT "doctor_time_off_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "doctor_availability_doctor_idx" ON "doctor_availability_rules" USING btree ("doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_availability_rule_uq" ON "doctor_availability_rules" USING btree ("doctor_id","weekday","start_time","end_time");--> statement-breakpoint
CREATE INDEX "doctor_documents_doctor_idx" ON "doctor_documents" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "doctor_profiles_status_idx" ON "doctor_profiles" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "doctor_profiles_department_idx" ON "doctor_profiles" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "doctor_time_off_doctor_idx" ON "doctor_time_off" USING btree ("doctor_id","starts_at");