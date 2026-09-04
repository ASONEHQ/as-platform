CREATE TABLE "refund_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"quantity" numeric(19, 6) NOT NULL,
	"subtotal" numeric(19, 4) NOT NULL,
	"tax_total" numeric(19, 4) NOT NULL,
	"line_total" numeric(19, 4) NOT NULL,
	"restock_disposition" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_items_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "refund_items_refund_sale_item_uq" UNIQUE("company_id","refund_id","sale_item_id"),
	CONSTRAINT "refund_items_quantity_ck" CHECK ("refund_items"."quantity" > 0),
	CONSTRAINT "refund_items_subtotal_ck" CHECK ("refund_items"."subtotal" >= 0),
	CONSTRAINT "refund_items_tax_total_ck" CHECK ("refund_items"."tax_total" >= 0),
	CONSTRAINT "refund_items_line_total_ck" CHECK ("refund_items"."line_total" >= 0),
	CONSTRAINT "refund_items_line_arithmetic_ck" CHECK ("refund_items"."line_total" = "refund_items"."subtotal" + "refund_items"."tax_total"),
	CONSTRAINT "refund_items_disposition_ck" CHECK ("refund_items"."restock_disposition" in ('restock','damage','quarantine','no_restock'))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"cash_session_id" uuid,
	"payment_id" uuid,
	"refund_number" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"refund_method" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason_note" text,
	"currency_code" char(3) NOT NULL,
	"subtotal" numeric(19, 4) NOT NULL,
	"tax_total" numeric(19, 4) NOT NULL,
	"total" numeric(19, 4) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"device_id" uuid,
	"sync_operation_id" uuid,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "refunds_company_branch_id_uq" UNIQUE("company_id","branch_id","id"),
	CONSTRAINT "refunds_company_branch_number_uq" UNIQUE("company_id","branch_id","refund_number"),
	CONSTRAINT "refunds_number_nonblank_ck" CHECK (length(btrim("refunds"."refund_number")) > 0),
	CONSTRAINT "refunds_currency_code_ck" CHECK ("refunds"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "refunds_status_ck" CHECK ("refunds"."status" in ('requested','pending_approval','approved','completed','cancelled','rejected')),
	CONSTRAINT "refunds_method_ck" CHECK ("refunds"."refund_method" in ('cash','card_terminal','card_manual','other')),
	CONSTRAINT "refunds_reason_code_nonblank_ck" CHECK (length(btrim("refunds"."reason_code")) > 0),
	CONSTRAINT "refunds_subtotal_ck" CHECK ("refunds"."subtotal" >= 0),
	CONSTRAINT "refunds_tax_total_ck" CHECK ("refunds"."tax_total" >= 0),
	CONSTRAINT "refunds_total_positive_ck" CHECK ("refunds"."total" > 0),
	CONSTRAINT "refunds_arithmetic_ck" CHECK ("refunds"."total" = "refunds"."subtotal" + "refunds"."tax_total"),
	CONSTRAINT "refunds_completed_fields_ck" CHECK (("refunds"."status" <> 'completed'
          and "refunds"."completed_at" is null)
        or ("refunds"."status" = 'completed'
          and "refunds"."completed_at" is not null and "refunds"."payment_id" is not null)),
	CONSTRAINT "refunds_cash_session_only_when_cash_ck" CHECK ("refunds"."cash_session_id" is null or "refunds"."refund_method" = 'cash'),
	CONSTRAINT "refunds_version_ck" CHECK ("refunds"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "cash_movements" DROP CONSTRAINT "cash_movements_type_ck";--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refund_scope_fk" FOREIGN KEY ("company_id","refund_id") REFERENCES "public"."refunds"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_sale_item_scope_fk" FOREIGN KEY ("company_id","sale_item_id") REFERENCES "public"."sale_items"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_sale_scope_fk" FOREIGN KEY ("company_id","branch_id","sale_id") REFERENCES "public"."sales"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_cash_session_scope_fk" FOREIGN KEY ("company_id","branch_id","cash_session_id") REFERENCES "public"."cash_sessions"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_scope_fk" FOREIGN KEY ("company_id","payment_id") REFERENCES "public"."payments"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_device_scope_fk" FOREIGN KEY ("company_id","device_id") REFERENCES "public"."devices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_membership_fk" FOREIGN KEY ("company_id","approved_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_items_refund_idx" ON "refund_items" USING btree ("company_id","refund_id");--> statement-breakpoint
CREATE INDEX "refund_items_sale_item_idx" ON "refund_items" USING btree ("company_id","sale_item_id");--> statement-breakpoint
CREATE INDEX "refunds_company_branch_idx" ON "refunds" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "refunds_company_sale_idx" ON "refunds" USING btree ("company_id","sale_id");--> statement-breakpoint
CREATE INDEX "refunds_company_status_idx" ON "refunds" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "refunds_company_occurred_idx" ON "refunds" USING btree ("company_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_movements_refund_reference_uq" ON "cash_movements" USING btree ("company_id","reference_id") WHERE "cash_movements"."reference_type" = 'refund';--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_refund_reference_uq" ON "inventory_movements" USING btree ("company_id","reference_id") WHERE "inventory_movements"."reference_type" = 'refund';--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_type_ck" CHECK ("cash_movements"."movement_type" in ('opening_float','cash_sale','cash_in','cash_out','cash_refund'));