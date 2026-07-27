CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "brands_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "brands_company_code_uq" UNIQUE("company_id","normalized_code"),
	CONSTRAINT "brands_code_nonblank_ck" CHECK (length(btrim("brands"."code")) > 0),
	CONSTRAINT "brands_normalized_code_ck" CHECK (length("brands"."normalized_code") > 0 and "brands"."normalized_code" = lower(btrim("brands"."normalized_code"))),
	CONSTRAINT "brands_name_nonblank_ck" CHECK (length(btrim("brands"."name")) > 0),
	CONSTRAINT "brands_status_ck" CHECK ("brands"."status" in ('active', 'inactive', 'retired')),
	CONSTRAINT "brands_version_ck" CHECK ("brands"."version" >= 1),
	CONSTRAINT "brands_retirement_ck" CHECK (("brands"."status" = 'retired' and "brands"."deleted_at" is not null)
        or ("brands"."status" <> 'retired' and "brands"."deleted_at" is null))
);
--> statement-breakpoint
CREATE TABLE "product_barcodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"barcode_type" text NOT NULL,
	"barcode" text NOT NULL,
	"normalized_barcode" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "product_barcodes_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "product_barcodes_barcode_nonblank_ck" CHECK (length(btrim("product_barcodes"."barcode")) > 0),
	CONSTRAINT "product_barcodes_normalized_barcode_nonblank_ck" CHECK (length("product_barcodes"."normalized_barcode") > 0),
	CONSTRAINT "product_barcodes_type_ck" CHECK ("product_barcodes"."barcode_type" in ('ean13', 'upca', 'code128', 'qr', 'internal')),
	CONSTRAINT "product_barcodes_status_ck" CHECK ("product_barcodes"."status" in ('active', 'inactive', 'retired')),
	CONSTRAINT "product_barcodes_version_ck" CHECK ("product_barcodes"."version" >= 1),
	CONSTRAINT "product_barcodes_retirement_ck" CHECK (("product_barcodes"."status" = 'retired' and "product_barcodes"."deleted_at" is not null and "product_barcodes"."is_primary" is false)
        or ("product_barcodes"."status" <> 'retired' and "product_barcodes"."deleted_at" is null))
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "product_categories_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "product_categories_company_code_uq" UNIQUE("company_id","normalized_code"),
	CONSTRAINT "product_categories_code_nonblank_ck" CHECK (length(btrim("product_categories"."code")) > 0),
	CONSTRAINT "product_categories_normalized_code_ck" CHECK (length("product_categories"."normalized_code") > 0 and "product_categories"."normalized_code" = lower(btrim("product_categories"."normalized_code"))),
	CONSTRAINT "product_categories_name_nonblank_ck" CHECK (length(btrim("product_categories"."name")) > 0),
	CONSTRAINT "product_categories_sort_order_ck" CHECK ("product_categories"."sort_order" >= 0),
	CONSTRAINT "product_categories_status_ck" CHECK ("product_categories"."status" in ('active', 'inactive', 'retired')),
	CONSTRAINT "product_categories_version_ck" CHECK ("product_categories"."version" >= 1),
	CONSTRAINT "product_categories_retirement_ck" CHECK (("product_categories"."status" = 'retired' and "product_categories"."deleted_at" is not null)
        or ("product_categories"."status" <> 'retired' and "product_categories"."deleted_at" is null)),
	CONSTRAINT "product_categories_not_self_parent_ck" CHECK ("product_categories"."parent_id" is null or "product_categories"."parent_id" <> "product_categories"."id")
);
--> statement-breakpoint
CREATE TABLE "product_option_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "product_option_definitions_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "product_option_definitions_product_id_id_uq" UNIQUE("company_id","product_id","id"),
	CONSTRAINT "product_option_definitions_product_code_uq" UNIQUE("company_id","product_id","normalized_code"),
	CONSTRAINT "product_option_definitions_code_nonblank_ck" CHECK (length(btrim("product_option_definitions"."code")) > 0),
	CONSTRAINT "product_option_definitions_normalized_code_ck" CHECK (length("product_option_definitions"."normalized_code") > 0 and "product_option_definitions"."normalized_code" = lower(btrim("product_option_definitions"."normalized_code"))),
	CONSTRAINT "product_option_definitions_name_nonblank_ck" CHECK (length(btrim("product_option_definitions"."name")) > 0),
	CONSTRAINT "product_option_definitions_sort_order_ck" CHECK ("product_option_definitions"."sort_order" >= 0),
	CONSTRAINT "product_option_definitions_status_ck" CHECK ("product_option_definitions"."status" in ('active', 'inactive', 'retired')),
	CONSTRAINT "product_option_definitions_version_ck" CHECK ("product_option_definitions"."version" >= 1),
	CONSTRAINT "product_option_definitions_retirement_ck" CHECK (("product_option_definitions"."status" = 'retired' and "product_option_definitions"."deleted_at" is not null)
        or ("product_option_definitions"."status" <> 'retired' and "product_option_definitions"."deleted_at" is null))
);
--> statement-breakpoint
CREATE TABLE "product_option_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"option_definition_id" uuid NOT NULL,
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "product_option_values_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "product_option_values_definition_id_id_uq" UNIQUE("company_id","product_id","option_definition_id","id"),
	CONSTRAINT "product_option_values_definition_code_uq" UNIQUE("company_id","option_definition_id","normalized_code"),
	CONSTRAINT "product_option_values_code_nonblank_ck" CHECK (length(btrim("product_option_values"."code")) > 0),
	CONSTRAINT "product_option_values_normalized_code_ck" CHECK (length("product_option_values"."normalized_code") > 0 and "product_option_values"."normalized_code" = lower(btrim("product_option_values"."normalized_code"))),
	CONSTRAINT "product_option_values_name_nonblank_ck" CHECK (length(btrim("product_option_values"."name")) > 0),
	CONSTRAINT "product_option_values_sort_order_ck" CHECK ("product_option_values"."sort_order" >= 0),
	CONSTRAINT "product_option_values_status_ck" CHECK ("product_option_values"."status" in ('active', 'inactive', 'retired')),
	CONSTRAINT "product_option_values_version_ck" CHECK ("product_option_values"."version" >= 1),
	CONSTRAINT "product_option_values_retirement_ck" CHECK (("product_option_values"."status" = 'retired' and "product_option_values"."deleted_at" is not null)
        or ("product_option_values"."status" <> 'retired' and "product_option_values"."deleted_at" is null))
);
--> statement-breakpoint
CREATE TABLE "product_variant_option_values" (
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"option_definition_id" uuid NOT NULL,
	"option_value_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variant_option_values_pk" PRIMARY KEY("company_id","product_variant_id","option_definition_id"),
	CONSTRAINT "product_variant_option_values_value_uq" UNIQUE("company_id","product_variant_id","option_value_id")
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"normalized_sku" text NOT NULL,
	"name" text,
	"unit_of_measure_code" text NOT NULL,
	"quantity_scale" integer NOT NULL,
	"tracks_inventory" boolean NOT NULL,
	"standard_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"currency_code" char(3) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"option_signature" char(64) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "product_variants_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "product_variants_product_id_id_uq" UNIQUE("company_id","product_id","id"),
	CONSTRAINT "product_variants_sku_nonblank_ck" CHECK (length(btrim("product_variants"."sku")) > 0),
	CONSTRAINT "product_variants_normalized_sku_ck" CHECK (length("product_variants"."normalized_sku") > 0 and "product_variants"."normalized_sku" = lower(btrim("product_variants"."normalized_sku"))),
	CONSTRAINT "product_variants_quantity_scale_ck" CHECK ("product_variants"."quantity_scale" between 0 and 6),
	CONSTRAINT "product_variants_standard_cost_ck" CHECK ("product_variants"."standard_cost" >= 0),
	CONSTRAINT "product_variants_currency_code_ck" CHECK ("product_variants"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "product_variants_option_signature_ck" CHECK ("product_variants"."option_signature" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "product_variants_status_ck" CHECK ("product_variants"."status" in ('active', 'inactive', 'retired')),
	CONSTRAINT "product_variants_version_ck" CHECK ("product_variants"."version" >= 1),
	CONSTRAINT "product_variants_retirement_ck" CHECK (("product_variants"."status" = 'retired' and "product_variants"."deleted_at" is not null and "product_variants"."is_default" is false)
        or ("product_variants"."status" <> 'retired' and "product_variants"."deleted_at" is null))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"category_id" uuid,
	"brand_id" uuid,
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"product_type" text NOT NULL,
	"tracks_inventory" boolean NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "products_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "products_company_code_uq" UNIQUE("company_id","normalized_code"),
	CONSTRAINT "products_code_nonblank_ck" CHECK (length(btrim("products"."code")) > 0),
	CONSTRAINT "products_normalized_code_ck" CHECK (length("products"."normalized_code") > 0 and "products"."normalized_code" = lower(btrim("products"."normalized_code"))),
	CONSTRAINT "products_name_nonblank_ck" CHECK (length(btrim("products"."name")) > 0),
	CONSTRAINT "products_type_ck" CHECK ("products"."product_type" in ('simple', 'variable', 'kit', 'service')),
	CONSTRAINT "products_status_ck" CHECK ("products"."status" in ('draft', 'active', 'inactive', 'retired')),
	CONSTRAINT "products_version_ck" CHECK ("products"."version" >= 1),
	CONSTRAINT "products_retirement_ck" CHECK (("products"."status" = 'retired' and "products"."deleted_at" is not null)
        or ("products"."status" <> 'retired' and "products"."deleted_at" is null)),
	CONSTRAINT "products_non_inventory_type_ck" CHECK ("products"."product_type" not in ('service', 'kit') or "products"."tracks_inventory" is false)
);
--> statement-breakpoint
CREATE TABLE "units_of_measure" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dimension" text NOT NULL,
	"quantity_scale" integer NOT NULL,
	"conversion_factor_to_base" numeric(19, 6) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "units_of_measure_code_nonblank_ck" CHECK (length(btrim("units_of_measure"."code")) > 0),
	CONSTRAINT "units_of_measure_name_nonblank_ck" CHECK (length(btrim("units_of_measure"."name")) > 0),
	CONSTRAINT "units_of_measure_dimension_ck" CHECK ("units_of_measure"."dimension" in ('count', 'mass', 'volume')),
	CONSTRAINT "units_of_measure_quantity_scale_ck" CHECK ("units_of_measure"."quantity_scale" between 0 and 6),
	CONSTRAINT "units_of_measure_conversion_factor_ck" CHECK ("units_of_measure"."conversion_factor_to_base" > 0),
	CONSTRAINT "units_of_measure_status_ck" CHECK ("units_of_measure"."status" in ('active', 'retired'))
);
--> statement-breakpoint
INSERT INTO "units_of_measure"
	("code", "name", "dimension", "quantity_scale", "conversion_factor_to_base", "status")
VALUES
	('unit', 'Unit', 'count', 0, 1.000000, 'active'),
	('kg', 'Kilogram', 'mass', 6, 1.000000, 'active'),
	('g', 'Gram', 'mass', 3, 0.001000, 'active'),
	('l', 'Litre', 'volume', 6, 1.000000, 'active'),
	('ml', 'Millilitre', 'volume', 3, 0.001000, 'active')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_code_format_ck";--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_variant_scope_fk" FOREIGN KEY ("company_id","product_variant_id") REFERENCES "public"."product_variants"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_scope_fk" FOREIGN KEY ("company_id","parent_id") REFERENCES "public"."product_categories"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_definitions" ADD CONSTRAINT "product_option_definitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_definitions" ADD CONSTRAINT "product_option_definitions_product_scope_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_definitions" ADD CONSTRAINT "product_option_definitions_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_definitions" ADD CONSTRAINT "product_option_definitions_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_product_scope_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_definition_scope_fk" FOREIGN KEY ("company_id","product_id","option_definition_id") REFERENCES "public"."product_option_definitions"("company_id","product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_variant_scope_fk" FOREIGN KEY ("company_id","product_id","product_variant_id") REFERENCES "public"."product_variants"("company_id","product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_definition_scope_fk" FOREIGN KEY ("company_id","product_id","option_definition_id") REFERENCES "public"."product_option_definitions"("company_id","product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_value_scope_fk" FOREIGN KEY ("company_id","product_id","option_definition_id","option_value_id") REFERENCES "public"."product_option_values"("company_id","product_id","option_definition_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_unit_of_measure_code_units_of_measure_code_fk" FOREIGN KEY ("unit_of_measure_code") REFERENCES "public"."units_of_measure"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_scope_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_scope_fk" FOREIGN KEY ("company_id","category_id") REFERENCES "public"."product_categories"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_scope_fk" FOREIGN KEY ("company_id","brand_id") REFERENCES "public"."brands"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brands_company_status_idx" ON "brands" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "product_barcodes_company_barcode_active_uq" ON "product_barcodes" USING btree ("company_id","normalized_barcode") WHERE "product_barcodes"."status" <> 'retired' and "product_barcodes"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_barcodes_variant_primary_active_uq" ON "product_barcodes" USING btree ("company_id","product_variant_id") WHERE "product_barcodes"."is_primary" is true and "product_barcodes"."status" <> 'retired' and "product_barcodes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "product_barcodes_variant_status_idx" ON "product_barcodes" USING btree ("company_id","product_variant_id","status");--> statement-breakpoint
CREATE INDEX "product_categories_company_parent_idx" ON "product_categories" USING btree ("company_id","parent_id");--> statement-breakpoint
CREATE INDEX "product_categories_company_status_idx" ON "product_categories" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "product_option_definitions_product_status_idx" ON "product_option_definitions" USING btree ("company_id","product_id","status");--> statement-breakpoint
CREATE INDEX "product_option_values_definition_status_idx" ON "product_option_values" USING btree ("company_id","option_definition_id","status");--> statement-breakpoint
CREATE INDEX "product_variant_option_values_product_idx" ON "product_variant_option_values" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "product_variant_option_values_value_idx" ON "product_variant_option_values" USING btree ("company_id","option_value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_company_sku_active_uq" ON "product_variants" USING btree ("company_id","normalized_sku") WHERE "product_variants"."status" <> 'retired' and "product_variants"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_default_active_uq" ON "product_variants" USING btree ("company_id","product_id") WHERE "product_variants"."is_default" is true and "product_variants"."status" <> 'retired' and "product_variants"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_option_signature_active_uq" ON "product_variants" USING btree ("company_id","product_id","option_signature") WHERE "product_variants"."status" <> 'retired' and "product_variants"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "product_variants_product_status_idx" ON "product_variants" USING btree ("company_id","product_id","status");--> statement-breakpoint
CREATE INDEX "products_company_category_idx" ON "products" USING btree ("company_id","category_id");--> statement-breakpoint
CREATE INDEX "products_company_brand_idx" ON "products" USING btree ("company_id","brand_id");--> statement-breakpoint
CREATE INDEX "products_company_status_idx" ON "products" USING btree ("company_id","status");--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_code_format_ck" CHECK ("permissions"."code" ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$');
