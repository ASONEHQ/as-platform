CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"product_id" uuid,
	"product_version" bigint,
	"sku_snapshot" text,
	"name_snapshot" text NOT NULL,
	"quantity" numeric(19, 6) NOT NULL,
	"unit_price" numeric(19, 4) NOT NULL,
	"subtotal" numeric(19, 4) NOT NULL,
	"discount_total" numeric(19, 4) DEFAULT 0 NOT NULL,
	"tax_total" numeric(19, 4) NOT NULL,
	"line_total" numeric(19, 4) NOT NULL,
	"tax_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_items_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "sale_items_sale_line_uq" UNIQUE("company_id","sale_id","line_number"),
	CONSTRAINT "sale_items_line_number_ck" CHECK ("sale_items"."line_number" >= 1),
	CONSTRAINT "sale_items_quantity_ck" CHECK ("sale_items"."quantity" > 0),
	CONSTRAINT "sale_items_unit_price_ck" CHECK ("sale_items"."unit_price" >= 0),
	CONSTRAINT "sale_items_subtotal_ck" CHECK ("sale_items"."subtotal" >= 0),
	CONSTRAINT "sale_items_tax_total_ck" CHECK ("sale_items"."tax_total" >= 0),
	CONSTRAINT "sale_items_line_total_ck" CHECK ("sale_items"."line_total" >= 0),
	CONSTRAINT "sale_items_name_nonblank_ck" CHECK (length(btrim("sale_items"."name_snapshot")) > 0),
	CONSTRAINT "sale_items_tax_snapshot_object_ck" CHECK ("sale_items"."tax_snapshot" is null or jsonb_typeof("sale_items"."tax_snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cash_register_id" uuid,
	"cash_session_id" uuid,
	"device_id" uuid,
	"sync_operation_id" uuid,
	"sale_number" text NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"currency_code" char(3) NOT NULL,
	"subtotal" numeric(19, 4) NOT NULL,
	"discount_total" numeric(19, 4) DEFAULT 0 NOT NULL,
	"tax_total" numeric(19, 4) NOT NULL,
	"total" numeric(19, 4) NOT NULL,
	"paid_total" numeric(19, 4) DEFAULT 0 NOT NULL,
	"change_total" numeric(19, 4) DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"reason_code" text,
	"created_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "sales_company_branch_id_uq" UNIQUE("company_id","branch_id","id"),
	CONSTRAINT "sales_company_branch_number_uq" UNIQUE("company_id","branch_id","sale_number"),
	CONSTRAINT "sales_number_nonblank_ck" CHECK (length(btrim("sales"."sale_number")) > 0),
	CONSTRAINT "sales_currency_code_ck" CHECK ("sales"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "sales_status_ck" CHECK ("sales"."status" in ('draft', 'pending_payment', 'completed', 'cancelled', 'rejected')),
	CONSTRAINT "sales_subtotal_ck" CHECK ("sales"."subtotal" >= 0),
	CONSTRAINT "sales_discount_total_ck" CHECK ("sales"."discount_total" >= 0),
	CONSTRAINT "sales_tax_total_ck" CHECK ("sales"."tax_total" >= 0),
	CONSTRAINT "sales_total_ck" CHECK ("sales"."total" >= 0),
	CONSTRAINT "sales_paid_total_ck" CHECK ("sales"."paid_total" >= 0),
	CONSTRAINT "sales_change_total_ck" CHECK ("sales"."change_total" >= 0),
	CONSTRAINT "sales_arithmetic_ck" CHECK ("sales"."total" = "sales"."subtotal" - "sales"."discount_total" + "sales"."tax_total"),
	CONSTRAINT "sales_completed_at_ck" CHECK ("sales"."status" <> 'completed' or "sales"."completed_at" is not null),
	CONSTRAINT "sales_cancelled_at_ck" CHECK ("sales"."status" <> 'cancelled' or ("sales"."cancelled_at" is not null and "sales"."cancelled_by" is not null)),
	CONSTRAINT "sales_version_ck" CHECK ("sales"."version" >= 1)
);
--> statement-breakpoint
DROP INDEX "payments_company_sale_reference_idx";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_scope_fk" FOREIGN KEY ("company_id","sale_id") REFERENCES "public"."sales"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_scope_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_device_scope_fk" FOREIGN KEY ("company_id","device_id") REFERENCES "public"."devices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("company_id","sale_id");--> statement-breakpoint
CREATE INDEX "sales_company_branch_idx" ON "sales" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "sales_company_status_idx" ON "sales" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "payments_company_sale_idx" ON "payments" USING btree ("company_id","sale_id");