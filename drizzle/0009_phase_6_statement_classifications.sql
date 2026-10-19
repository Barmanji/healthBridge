CREATE TYPE "public"."statement_category" AS ENUM('symptom', 'duration', 'medication', 'allergy', 'medical_history', 'other');--> statement-breakpoint
CREATE TYPE "public"."statement_classification_status" AS ENUM('auto', 'uncertain', 'corrected', 'unavailable');--> statement-breakpoint
CREATE TABLE "statement_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"statement_index" integer NOT NULL,
	"statement" text NOT NULL,
	"language_code" text,
	"model_version" text,
	"predicted_category" "statement_category",
	"confidence" real,
	"status" "statement_classification_status" DEFAULT 'auto' NOT NULL,
	"corrected_category" "statement_category",
	"corrected_by_user_id" text,
	"corrected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "statement_classifications" ADD CONSTRAINT "statement_classifications_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_classifications" ADD CONSTRAINT "statement_classifications_corrected_by_user_id_user_id_fk" FOREIGN KEY ("corrected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "statement_classifications_message_idx_uq" ON "statement_classifications" USING btree ("message_id","statement_index");--> statement-breakpoint
CREATE INDEX "statement_classifications_message_idx" ON "statement_classifications" USING btree ("message_id");