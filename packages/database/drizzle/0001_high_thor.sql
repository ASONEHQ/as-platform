CREATE TABLE "session_refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"generation" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"reused_at" timestamp with time zone,
	CONSTRAINT "session_refresh_tokens_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "session_refresh_tokens_session_generation_uq" UNIQUE("session_id","generation"),
	CONSTRAINT "session_refresh_tokens_hash_length_ck" CHECK (length(btrim("session_refresh_tokens"."token_hash")) >= 32),
	CONSTRAINT "session_refresh_tokens_generation_ck" CHECK ("session_refresh_tokens"."generation" >= 0),
	CONSTRAINT "session_refresh_tokens_status_ck" CHECK ("session_refresh_tokens"."status" in ('active', 'rotated', 'revoked', 'reused')),
	CONSTRAINT "session_refresh_tokens_expiry_ck" CHECK ("session_refresh_tokens"."expires_at" > "session_refresh_tokens"."created_at")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "token_family_id" uuid;--> statement-breakpoint
UPDATE "sessions" SET "token_family_id" = "id" WHERE "token_family_id" IS NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "token_family_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "token_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "reuse_detected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "revocation_reason" text;--> statement-breakpoint
INSERT INTO "session_refresh_tokens" ("id", "session_id", "token_hash", "generation", "status", "created_at", "expires_at")
SELECT "id", "id", "token_hash", 0, CASE WHEN "status" = 'active' THEN 'active' ELSE 'revoked' END, "created_at", "expires_at"
FROM "sessions";--> statement-breakpoint
ALTER TABLE "session_refresh_tokens" ADD CONSTRAINT "session_refresh_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_refresh_tokens_session_idx" ON "session_refresh_tokens" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_token_family_idx" ON "sessions" USING btree ("token_family_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_token_generation_ck" CHECK ("sessions"."token_generation" >= 0);
