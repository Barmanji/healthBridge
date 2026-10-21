CREATE TYPE "public"."conversation_title_source" AS ENUM('auto', 'patient');--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "title_source" "conversation_title_source" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "title_updated_at" timestamp;