CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_company_coupon_sale_uq" UNIQUE("company_id","coupon_id","sale_id"),
	CONSTRAINT "coupon_redemptions_amount_ck" CHECK ("coupon_redemptions"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"description" text,
	"benefit_type" text NOT NULL,
	"benefit_percentage_basis_points" integer,
	"benefit_fixed_amount" numeric(19, 4),
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"min_subtotal" numeric(19, 4),
	"usage_limit_total" integer,
	"promotion_id" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "coupons_company_normalized_code_uq" UNIQUE("company_id","normalized_code"),
	CONSTRAINT "coupons_code_nonblank_ck" CHECK (length(btrim("coupons"."code")) > 0),
	CONSTRAINT "coupons_normalized_code_ck" CHECK (length("coupons"."normalized_code") > 0 and "coupons"."normalized_code" = upper(btrim("coupons"."normalized_code"))),
	CONSTRAINT "coupons_benefit_type_ck" CHECK ("coupons"."benefit_type" in ('percentage','fixed_amount')),
	CONSTRAINT "coupons_benefit_fields_ck" CHECK (("coupons"."benefit_type" = 'percentage'
            and "coupons"."benefit_percentage_basis_points" is not null and "coupons"."benefit_percentage_basis_points" > 0
              and "coupons"."benefit_percentage_basis_points" <= 10000
            and "coupons"."benefit_fixed_amount" is null)
        or ("coupons"."benefit_type" = 'fixed_amount'
            and "coupons"."benefit_fixed_amount" is not null and "coupons"."benefit_fixed_amount" >= 0
            and "coupons"."benefit_percentage_basis_points" is null)),
	CONSTRAINT "coupons_validity_window_ck" CHECK ("coupons"."starts_at" is null or "coupons"."ends_at" is null or "coupons"."starts_at" < "coupons"."ends_at"),
	CONSTRAINT "coupons_min_subtotal_ck" CHECK ("coupons"."min_subtotal" is null or "coupons"."min_subtotal" >= 0),
	CONSTRAINT "coupons_usage_limit_total_ck" CHECK ("coupons"."usage_limit_total" is null or "coupons"."usage_limit_total" > 0),
	CONSTRAINT "coupons_version_ck" CHECK ("coupons"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "promotion_branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"promotion_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_branches_company_promotion_branch_uq" UNIQUE("company_id","promotion_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "promotion_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"promotion_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_categories_company_promotion_category_uq" UNIQUE("company_id","promotion_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "promotion_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"promotion_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_products_company_promotion_product_uq" UNIQUE("company_id","promotion_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"days_of_week" integer[],
	"time_from" text,
	"time_to" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"stackable" boolean DEFAULT false NOT NULL,
	"benefit_type" text NOT NULL,
	"benefit_percentage_basis_points" integer,
	"benefit_fixed_amount" numeric(19, 4),
	"benefit_nxm_buy_quantity" integer,
	"benefit_nxm_pay_quantity" integer,
	"min_quantity" numeric(19, 6),
	"min_subtotal" numeric(19, 4),
	"usage_limit_total" integer,
	"combinable_with_coupons" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "promotions_name_nonblank_ck" CHECK (length(btrim("promotions"."name")) > 0),
	CONSTRAINT "promotions_benefit_type_ck" CHECK ("promotions"."benefit_type" in ('percentage','fixed_amount','fixed_price','quantity_nxm')),
	CONSTRAINT "promotions_benefit_fields_ck" CHECK (("promotions"."benefit_type" = 'percentage'
            and "promotions"."benefit_percentage_basis_points" is not null and "promotions"."benefit_percentage_basis_points" > 0
              and "promotions"."benefit_percentage_basis_points" <= 10000
            and "promotions"."benefit_fixed_amount" is null
            and "promotions"."benefit_nxm_buy_quantity" is null and "promotions"."benefit_nxm_pay_quantity" is null)
        or ("promotions"."benefit_type" in ('fixed_amount','fixed_price')
            and "promotions"."benefit_fixed_amount" is not null and "promotions"."benefit_fixed_amount" >= 0
            and "promotions"."benefit_percentage_basis_points" is null
            and "promotions"."benefit_nxm_buy_quantity" is null and "promotions"."benefit_nxm_pay_quantity" is null)
        or ("promotions"."benefit_type" = 'quantity_nxm'
            and "promotions"."benefit_nxm_buy_quantity" is not null and "promotions"."benefit_nxm_pay_quantity" is not null
              and "promotions"."benefit_nxm_pay_quantity" > 0 and "promotions"."benefit_nxm_buy_quantity" > "promotions"."benefit_nxm_pay_quantity"
            and "promotions"."benefit_percentage_basis_points" is null and "promotions"."benefit_fixed_amount" is null)),
	CONSTRAINT "promotions_priority_ck" CHECK ("promotions"."priority" >= 0),
	CONSTRAINT "promotions_validity_window_ck" CHECK ("promotions"."starts_at" is null or "promotions"."ends_at" is null or "promotions"."starts_at" < "promotions"."ends_at"),
	CONSTRAINT "promotions_days_of_week_ck" CHECK ("promotions"."days_of_week" is null or "promotions"."days_of_week" <@ array[1,2,3,4,5,6,7]),
	CONSTRAINT "promotions_time_from_format_ck" CHECK ("promotions"."time_from" is null or "promotions"."time_from" ~ '^([01]\d|2[0-3]):[0-5]\d$'),
	CONSTRAINT "promotions_time_to_format_ck" CHECK ("promotions"."time_to" is null or "promotions"."time_to" ~ '^([01]\d|2[0-3]):[0-5]\d$'),
	CONSTRAINT "promotions_min_quantity_ck" CHECK ("promotions"."min_quantity" is null or "promotions"."min_quantity" > 0),
	CONSTRAINT "promotions_min_subtotal_ck" CHECK ("promotions"."min_subtotal" is null or "promotions"."min_subtotal" >= 0),
	CONSTRAINT "promotions_usage_limit_total_ck" CHECK ("promotions"."usage_limit_total" is null or "promotions"."usage_limit_total" > 0),
	CONSTRAINT "promotions_version_ck" CHECK ("promotions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "sale_discounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_item_id" uuid,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"label_snapshot" text NOT NULL,
	"reason_code" text,
	"amount" numeric(19, 4) NOT NULL,
	"basis_points" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_discounts_source_type_ck" CHECK ("sale_discounts"."source_type" in ('promotion','coupon','manual')),
	CONSTRAINT "sale_discounts_amount_ck" CHECK ("sale_discounts"."amount" >= 0),
	CONSTRAINT "sale_discounts_basis_points_ck" CHECK ("sale_discounts"."basis_points" is null or ("sale_discounts"."basis_points" >= 0 and "sale_discounts"."basis_points" <= 10000)),
	CONSTRAINT "sale_discounts_label_nonblank_ck" CHECK (length(btrim("sale_discounts"."label_snapshot")) > 0),
	CONSTRAINT "sale_discounts_source_fields_ck" CHECK (("sale_discounts"."source_type" in ('promotion','coupon') and "sale_discounts"."source_id" is not null and "sale_discounts"."reason_code" is null)
        or ("sale_discounts"."source_type" = 'manual' and "sale_discounts"."source_id" is null and "sale_discounts"."reason_code" is not null))
);
--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "discount_basis_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_scope_fk" FOREIGN KEY ("company_id","coupon_id") REFERENCES "public"."coupons"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_sale_scope_fk" FOREIGN KEY ("company_id","branch_id","sale_id") REFERENCES "public"."sales"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_promotion_scope_fk" FOREIGN KEY ("company_id","promotion_id") REFERENCES "public"."promotions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_branches" ADD CONSTRAINT "promotion_branches_promotion_scope_fk" FOREIGN KEY ("company_id","promotion_id") REFERENCES "public"."promotions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_branches" ADD CONSTRAINT "promotion_branches_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_categories" ADD CONSTRAINT "promotion_categories_promotion_scope_fk" FOREIGN KEY ("company_id","promotion_id") REFERENCES "public"."promotions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_categories" ADD CONSTRAINT "promotion_categories_category_scope_fk" FOREIGN KEY ("company_id","category_id") REFERENCES "public"."product_categories"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_promotion_scope_fk" FOREIGN KEY ("company_id","promotion_id") REFERENCES "public"."promotions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_product_scope_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_sale_scope_fk" FOREIGN KEY ("company_id","branch_id","sale_id") REFERENCES "public"."sales"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_sale_item_scope_fk" FOREIGN KEY ("company_id","sale_item_id") REFERENCES "public"."sale_items"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_idx" ON "coupon_redemptions" USING btree ("company_id","coupon_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_sale_idx" ON "coupon_redemptions" USING btree ("company_id","sale_id");--> statement-breakpoint
CREATE INDEX "coupons_company_active_idx" ON "coupons" USING btree ("company_id","active");--> statement-breakpoint
CREATE INDEX "promotion_branches_promotion_idx" ON "promotion_branches" USING btree ("company_id","promotion_id");--> statement-breakpoint
CREATE INDEX "promotion_categories_promotion_idx" ON "promotion_categories" USING btree ("company_id","promotion_id");--> statement-breakpoint
CREATE INDEX "promotion_categories_category_idx" ON "promotion_categories" USING btree ("company_id","category_id");--> statement-breakpoint
CREATE INDEX "promotion_products_promotion_idx" ON "promotion_products" USING btree ("company_id","promotion_id");--> statement-breakpoint
CREATE INDEX "promotion_products_product_idx" ON "promotion_products" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "promotions_company_active_idx" ON "promotions" USING btree ("company_id","active");--> statement-breakpoint
CREATE INDEX "sale_discounts_sale_idx" ON "sale_discounts" USING btree ("company_id","sale_id");--> statement-breakpoint
CREATE INDEX "sale_discounts_sale_item_idx" ON "sale_discounts" USING btree ("company_id","sale_item_id");--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_discount_total_ck" CHECK ("sale_items"."discount_total" >= 0);--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_discount_not_exceed_subtotal_ck" CHECK ("sale_items"."discount_total" <= "sale_items"."subtotal");--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_discount_basis_points_ck" CHECK ("sale_items"."discount_basis_points" >= 0 and "sale_items"."discount_basis_points" <= 10000);--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_line_arithmetic_ck" CHECK ("sale_items"."line_total" = "sale_items"."subtotal" - "sale_items"."discount_total" + "sale_items"."tax_total");