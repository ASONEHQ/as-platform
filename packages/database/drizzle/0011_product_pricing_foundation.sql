CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"product_id" uuid NOT NULL,
	"price_type" text DEFAULT 'standard' NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "product_prices_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "product_prices_amount_ck" CHECK ("product_prices"."amount" >= 0),
	CONSTRAINT "product_prices_currency_code_ck" CHECK ("product_prices"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "product_prices_price_type_ck" CHECK ("product_prices"."price_type" = 'standard'),
	CONSTRAINT "product_prices_status_ck" CHECK ("product_prices"."status" in ('active', 'expired', 'cancelled')),
	CONSTRAINT "product_prices_version_ck" CHECK ("product_prices"."version" >= 1),
	CONSTRAINT "product_prices_valid_interval_ck" CHECK ("product_prices"."valid_until" is null or "product_prices"."valid_until" > "product_prices"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tax_code" text DEFAULT 'IVA_GENERAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_scope_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_prices_company_active_uq" ON "product_prices" USING btree ("company_id","product_id","price_type","currency_code") WHERE "product_prices"."branch_id" is null and "product_prices"."status" = 'active' and "product_prices"."valid_until" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_prices_branch_active_uq" ON "product_prices" USING btree ("company_id","branch_id","product_id","price_type","currency_code") WHERE "product_prices"."branch_id" is not null and "product_prices"."status" = 'active' and "product_prices"."valid_until" is null;--> statement-breakpoint
CREATE INDEX "product_prices_product_status_idx" ON "product_prices" USING btree ("company_id","product_id","status");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tax_code_ck" CHECK ("products"."tax_code" in ('IVA_GENERAL', 'IVA_EXEMPT'));