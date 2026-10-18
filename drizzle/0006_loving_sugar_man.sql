CREATE TABLE "voice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"vapi_call_id" text,
	"consent_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "voice_sessions_vapi_call_id_unique" UNIQUE("vapi_call_id")
);
--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_sessions_conversation_expiry_idx" ON "voice_sessions" USING btree ("conversation_id","expires_at");