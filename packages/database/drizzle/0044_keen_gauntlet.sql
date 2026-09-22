CREATE TABLE "membership_plan_benefit_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"membership_plan_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plan_benefit_categories_company_plan_category_uq" UNIQUE("company_id","membership_plan_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "membership_plan_benefit_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"membership_plan_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plan_benefit_products_company_plan_product_uq" UNIQUE("company_id","membership_plan_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "sale_discounts" DROP CONSTRAINT "sale_discounts_source_type_ck";--> statement-breakpoint
ALTER TABLE "sale_discounts" DROP CONSTRAINT "sale_discounts_source_fields_ck";--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "benefit_type" text;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "benefit_percentage_basis_points" integer;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "benefit_fixed_amount" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "membership_plan_benefit_categories" ADD CONSTRAINT "membership_plan_benefit_categories_plan_scope_fk" FOREIGN KEY ("company_id","membership_plan_id") REFERENCES "public"."membership_plans"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan_benefit_categories" ADD CONSTRAINT "membership_plan_benefit_categories_category_scope_fk" FOREIGN KEY ("company_id","category_id") REFERENCES "public"."product_categories"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan_benefit_products" ADD CONSTRAINT "membership_plan_benefit_products_plan_scope_fk" FOREIGN KEY ("company_id","membership_plan_id") REFERENCES "public"."membership_plans"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan_benefit_products" ADD CONSTRAINT "membership_plan_benefit_products_product_scope_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_plan_benefit_categories_plan_idx" ON "membership_plan_benefit_categories" USING btree ("company_id","membership_plan_id");--> statement-breakpoint
CREATE INDEX "membership_plan_benefit_categories_category_idx" ON "membership_plan_benefit_categories" USING btree ("company_id","category_id");--> statement-breakpoint
CREATE INDEX "membership_plan_benefit_products_plan_idx" ON "membership_plan_benefit_products" USING btree ("company_id","membership_plan_id");--> statement-breakpoint
CREATE INDEX "membership_plan_benefit_products_product_idx" ON "membership_plan_benefit_products" USING btree ("company_id","product_id");--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_benefit_type_ck" CHECK ("membership_plans"."benefit_type" is null or "membership_plans"."benefit_type" in ('percentage_discount','fixed_amount_discount','fixed_price'));--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_benefit_value_ck" CHECK (("membership_plans"."benefit_type" is null and "membership_plans"."benefit_percentage_basis_points" is null and "membership_plans"."benefit_fixed_amount" is null)
        or ("membership_plans"."benefit_type" = 'percentage_discount' and "membership_plans"."benefit_percentage_basis_points" is not null and "membership_plans"."benefit_fixed_amount" is null)
        or ("membership_plans"."benefit_type" in ('fixed_amount_discount','fixed_price') and "membership_plans"."benefit_fixed_amount" is not null and "membership_plans"."benefit_percentage_basis_points" is null));--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_benefit_basis_points_ck" CHECK ("membership_plans"."benefit_percentage_basis_points" is null or ("membership_plans"."benefit_percentage_basis_points" > 0 and "membership_plans"."benefit_percentage_basis_points" <= 10000));--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_benefit_fixed_amount_ck" CHECK ("membership_plans"."benefit_fixed_amount" is null or "membership_plans"."benefit_fixed_amount" >= 0);--> statement-breakpoint
ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_source_type_ck" CHECK ("sale_discounts"."source_type" in ('promotion','coupon','manual','reward','membership'));--> statement-breakpoint
ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_source_fields_ck" CHECK (("sale_discounts"."source_type" in ('promotion','coupon','reward','membership') and "sale_discounts"."source_id" is not null and "sale_discounts"."reason_code" is null)
        or ("sale_discounts"."source_type" = 'manual' and "sale_discounts"."source_id" is null and "sale_discounts"."reason_code" is not null));