CREATE TABLE "ai_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"name" text NOT NULL,
	"media_type" text NOT NULL,
	"kind" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_message_attachment" (
	"message_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "ai_message_attachment_message_id_attachment_id_pk" PRIMARY KEY("message_id","attachment_id")
);
--> statement-breakpoint
ALTER TABLE "ai_attachment" ADD CONSTRAINT "ai_attachment_conversation_id_ai_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_attachment" ADD CONSTRAINT "ai_message_attachment_message_id_ai_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_attachment" ADD CONSTRAINT "ai_message_attachment_attachment_id_ai_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."ai_attachment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_attachment_conversation" ON "ai_attachment" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_message_attachment_message" ON "ai_message_attachment" USING btree ("message_id","position");