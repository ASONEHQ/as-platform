ALTER TABLE "cash_sessions" ADD COLUMN "card_reconciliation" jsonb;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_card_reconciliation_ck" CHECK ("cash_sessions"."card_reconciliation" is null
        or ("cash_sessions"."status" = 'closed' and jsonb_typeof("cash_sessions"."card_reconciliation") = 'object'));