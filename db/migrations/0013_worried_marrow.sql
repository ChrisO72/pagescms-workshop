CREATE TABLE "ai_approval" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_sha" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decided_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ai_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"branch" text NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_run_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_run" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_message_id" text NOT NULL,
	"assistant_message_id" text,
	"model" text NOT NULL,
	"effort" text NOT NULL,
	"category" text NOT NULL,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"base_sha" text,
	"head_sha" text,
	"workspace_path" text,
	"failure" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_approval" ADD CONSTRAINT "ai_approval_run_id_ai_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_approval" ADD CONSTRAINT "ai_approval_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_conversation_id_ai_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run_event" ADD CONSTRAINT "ai_run_event_run_id_ai_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_conversation_id_ai_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_user_message_id_ai_message_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."ai_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_assistant_message_id_ai_message_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."ai_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_approval_run" ON "ai_approval" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_approval_status" ON "ai_approval" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ai_conversation_scope" ON "ai_conversation" USING btree ("user_id","owner","repo","branch","updated_at");--> statement-breakpoint
CREATE INDEX "idx_ai_message_conversation" ON "ai_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_run_event_run" ON "ai_run_event" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "idx_ai_run_conversation" ON "ai_run" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_run_status" ON "ai_run" USING btree ("status");