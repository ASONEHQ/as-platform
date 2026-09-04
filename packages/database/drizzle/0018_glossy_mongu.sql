ALTER TABLE "cash_sessions" ADD COLUMN "denomination_counts" jsonb;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_denomination_counts_ck" CHECK ("cash_sessions"."denomination_counts" is null
        or ("cash_sessions"."status" = 'closed' and jsonb_typeof("cash_sessions"."denomination_counts") = 'array'));