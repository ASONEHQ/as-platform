CREATE TABLE "loyalty_program_reward_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"loyalty_program_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_program_reward_categories_company_program_category_uq" UNIQUE("company_id","loyalty_program_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "loyalty_program_reward_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"loyalty_program_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_program_reward_products_company_program_product_uq" UNIQUE("company_id","loyalty_program_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "sale_reward_usages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"reward_entitlement_id" uuid NOT NULL,
	"loyalty_program_id" uuid NOT NULL,
	"reward_type" text NOT NULL,
	"benefit_type" text NOT NULL,
	"benefit_amount_snapshot" numeric(19, 4) NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	CONSTRAINT "sale_reward_usages_company_sale_uq" UNIQUE("company_id","sale_id"),
	CONSTRAINT "sale_reward_usages_reward_type_ck" CHECK ("sale_reward_usages"."reward_type" in ('vip_pass')),
	CONSTRAINT "sale_reward_usages_benefit_type_ck" CHECK ("sale_reward_usages"."benefit_type" in ('percentage_discount','fixed_amount_discount','fixed_price','free_eligible_item')),
	CONSTRAINT "sale_reward_usages_benefit_amount_ck" CHECK ("sale_reward_usages"."benefit_amount_snapshot" >= 0),
	CONSTRAINT "sale_reward_usages_status_ck" CHECK ("sale_reward_usages"."status" in ('applied','consumed','released')),
	CONSTRAINT "sale_reward_usages_consumed_at_ck" CHECK (("sale_reward_usages"."status" = 'consumed') = ("sale_reward_usages"."consumed_at" is not null)),
	CONSTRAINT "sale_reward_usages_released_at_ck" CHECK (("sale_reward_usages"."status" = 'released') = ("sale_reward_usages"."released_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "sale_discounts" DROP CONSTRAINT "sale_discounts_source_type_ck";--> statement-breakpoint
ALTER TABLE "sale_discounts" DROP CONSTRAINT "sale_discounts_source_fields_ck";--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD COLUMN "reward_benefit_type" text;--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD COLUMN "reward_benefit_percentage_basis_points" integer;--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD COLUMN "reward_benefit_fixed_amount" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "loyalty_program_reward_categories" ADD CONSTRAINT "loyalty_program_reward_categories_program_scope_fk" FOREIGN KEY ("company_id","loyalty_program_id") REFERENCES "public"."loyalty_programs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_program_reward_categories" ADD CONSTRAINT "loyalty_program_reward_categories_category_scope_fk" FOREIGN KEY ("company_id","category_id") REFERENCES "public"."product_categories"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_program_reward_products" ADD CONSTRAINT "loyalty_program_reward_products_program_scope_fk" FOREIGN KEY ("company_id","loyalty_program_id") REFERENCES "public"."loyalty_programs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_program_reward_products" ADD CONSTRAINT "loyalty_program_reward_products_product_scope_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_reward_usages" ADD CONSTRAINT "sale_reward_usages_sale_scope_fk" FOREIGN KEY ("company_id","branch_id","sale_id") REFERENCES "public"."sales"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_reward_usages" ADD CONSTRAINT "sale_reward_usages_sale_item_scope_fk" FOREIGN KEY ("company_id","sale_item_id") REFERENCES "public"."sale_items"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_reward_usages" ADD CONSTRAINT "sale_reward_usages_entitlement_scope_fk" FOREIGN KEY ("company_id","reward_entitlement_id") REFERENCES "public"."reward_entitlements"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_reward_usages" ADD CONSTRAINT "sale_reward_usages_program_scope_fk" FOREIGN KEY ("company_id","loyalty_program_id") REFERENCES "public"."loyalty_programs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loyalty_program_reward_categories_program_idx" ON "loyalty_program_reward_categories" USING btree ("company_id","loyalty_program_id");--> statement-breakpoint
CREATE INDEX "loyalty_program_reward_categories_category_idx" ON "loyalty_program_reward_categories" USING btree ("company_id","category_id");--> statement-breakpoint
CREATE INDEX "loyalty_program_reward_products_program_idx" ON "loyalty_program_reward_products" USING btree ("company_id","loyalty_program_id");--> statement-breakpoint
CREATE INDEX "loyalty_program_reward_products_product_idx" ON "loyalty_program_reward_products" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "sale_reward_usages_sale_idx" ON "sale_reward_usages" USING btree ("company_id","sale_id");--> statement-breakpoint
CREATE INDEX "sale_reward_usages_entitlement_idx" ON "sale_reward_usages" USING btree ("company_id","reward_entitlement_id");--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_reward_benefit_requires_reward_ck" CHECK ("loyalty_programs"."reward_benefit_type" is null or "loyalty_programs"."reward_type" is not null);--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_reward_benefit_type_ck" CHECK ("loyalty_programs"."reward_benefit_type" is null or "loyalty_programs"."reward_benefit_type" in ('percentage_discount','fixed_amount_discount','fixed_price','free_eligible_item'));--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_reward_benefit_value_ck" CHECK (("loyalty_programs"."reward_benefit_type" is null and "loyalty_programs"."reward_benefit_percentage_basis_points" is null and "loyalty_programs"."reward_benefit_fixed_amount" is null)
        or ("loyalty_programs"."reward_benefit_type" = 'percentage_discount' and "loyalty_programs"."reward_benefit_percentage_basis_points" is not null and "loyalty_programs"."reward_benefit_fixed_amount" is null)
        or ("loyalty_programs"."reward_benefit_type" in ('fixed_amount_discount','fixed_price') and "loyalty_programs"."reward_benefit_fixed_amount" is not null and "loyalty_programs"."reward_benefit_percentage_basis_points" is null)
        or ("loyalty_programs"."reward_benefit_type" = 'free_eligible_item' and "loyalty_programs"."reward_benefit_percentage_basis_points" is null and "loyalty_programs"."reward_benefit_fixed_amount" is null));--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_reward_benefit_basis_points_ck" CHECK ("loyalty_programs"."reward_benefit_percentage_basis_points" is null or ("loyalty_programs"."reward_benefit_percentage_basis_points" > 0 and "loyalty_programs"."reward_benefit_percentage_basis_points" <= 10000));--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_reward_benefit_fixed_amount_ck" CHECK ("loyalty_programs"."reward_benefit_fixed_amount" is null or "loyalty_programs"."reward_benefit_fixed_amount" >= 0);--> statement-breakpoint
ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_source_type_ck" CHECK ("sale_discounts"."source_type" in ('promotion','coupon','manual','reward'));--> statement-breakpoint
ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_source_fields_ck" CHECK (("sale_discounts"."source_type" in ('promotion','coupon','reward') and "sale_discounts"."source_id" is not null and "sale_discounts"."reason_code" is null)
        or ("sale_discounts"."source_type" = 'manual' and "sale_discounts"."source_id" is null and "sale_discounts"."reason_code" is not null));