ALTER TABLE "cash_sessions" ADD COLUMN "cash_sales_total" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "cash_sales_count" integer;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "cash_in_total" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "cash_out_total" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "withdrawal_total" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "expense_total" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "external_income_total" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "cash_refund_total" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "cash_refund_count" integer;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "payment_method_totals" jsonb;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "operational_summary" jsonb;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "discrepancy_reason" text;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_cash_refund_total_ck" CHECK ("cash_sessions"."cash_refund_total" is null or "cash_sessions"."status" = 'closed');--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_cash_refund_count_ck" CHECK ("cash_sessions"."cash_refund_count" is null or "cash_sessions"."status" = 'closed');--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_financial_breakdown_ck" CHECK (("cash_sessions"."cash_sales_total" is null and "cash_sessions"."cash_sales_count" is null
          and "cash_sessions"."cash_in_total" is null and "cash_sessions"."cash_out_total" is null
          and "cash_sessions"."withdrawal_total" is null and "cash_sessions"."expense_total" is null
          and "cash_sessions"."external_income_total" is null)
        or "cash_sessions"."status" = 'closed');--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_payment_method_totals_ck" CHECK ("cash_sessions"."payment_method_totals" is null
        or ("cash_sessions"."status" = 'closed' and jsonb_typeof("cash_sessions"."payment_method_totals") = 'array'));--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_operational_summary_ck" CHECK ("cash_sessions"."operational_summary" is null or "cash_sessions"."status" = 'closed');--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_discrepancy_reason_ck" CHECK ("cash_sessions"."discrepancy_reason" is null
        or ("cash_sessions"."status" = 'closed' and length(btrim("cash_sessions"."discrepancy_reason")) > 0));