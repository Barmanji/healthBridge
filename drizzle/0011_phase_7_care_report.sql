ALTER TABLE "triage_assessments" ADD COLUMN "care_report" jsonb;--> statement-breakpoint
ALTER TABLE "triage_assessments" ADD COLUMN "care_report_generated_at" timestamp;