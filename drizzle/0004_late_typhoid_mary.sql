CREATE TABLE "patient_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"preferred_language" text NOT NULL,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"consent_accepted_at" timestamp,
	"consent_version" text,
	"onboarding_completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patient_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "patient_profiles_contact_pair_check" CHECK (("patient_profiles"."emergency_contact_name" is null) = ("patient_profiles"."emergency_contact_phone" is null)),
	CONSTRAINT "patient_profiles_consent_pair_check" CHECK (("patient_profiles"."consent_accepted_at" is null) = ("patient_profiles"."consent_version" is null))
);
--> statement-breakpoint
ALTER TABLE "patient_profiles" ADD CONSTRAINT "patient_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_profiles_language_idx" ON "patient_profiles" USING btree ("preferred_language");