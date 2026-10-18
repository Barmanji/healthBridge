CREATE TYPE "public"."conversation_message_role" AS ENUM('patient', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."conversation_modality" AS ENUM('text', 'voice');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'halted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."risk_assessment" AS ENUM('not_critical', 'critical', 'needs_human_review');--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reply_to_message_id" uuid,
	"client_message_id" text,
	"role" "conversation_message_role" NOT NULL,
	"modality" "conversation_modality" NOT NULL,
	"language_code" text,
	"content" text NOT NULL,
	"content_english" text,
	"vapi_call_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"language_code" text DEFAULT 'hi-IN' NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"ai_processing_consent_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"assessment" "risk_assessment" NOT NULL,
	"triggered_by" text NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_taken" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_patient_id_patient_profiles_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_messages_thread_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_client_id_uq" ON "conversation_messages" USING btree ("conversation_id","client_message_id");--> statement-breakpoint
CREATE INDEX "conversations_patient_created_idx" ON "conversations" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "risk_events_conversation_created_idx" ON "risk_events" USING btree ("conversation_id","created_at");