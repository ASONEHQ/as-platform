CREATE TABLE "product_recipe_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"component_variant_id" uuid NOT NULL,
	"quantity" numeric(19, 6) NOT NULL,
	"unit_of_measure_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "product_recipe_components_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "product_recipe_components_recipe_variant_uq" UNIQUE("company_id","recipe_id","component_variant_id"),
	CONSTRAINT "product_recipe_components_quantity_ck" CHECK ("product_recipe_components"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "product_recipes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "product_recipes_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "product_recipes_company_variant_uq" UNIQUE("company_id","product_variant_id"),
	CONSTRAINT "product_recipes_version_ck" CHECK ("product_recipes"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "product_recipe_components" ADD CONSTRAINT "product_recipe_components_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_components" ADD CONSTRAINT "product_recipe_components_unit_of_measure_code_units_of_measure_code_fk" FOREIGN KEY ("unit_of_measure_code") REFERENCES "public"."units_of_measure"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_components" ADD CONSTRAINT "product_recipe_components_recipe_scope_fk" FOREIGN KEY ("company_id","recipe_id") REFERENCES "public"."product_recipes"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_components" ADD CONSTRAINT "product_recipe_components_variant_scope_fk" FOREIGN KEY ("company_id","component_variant_id") REFERENCES "public"."product_variants"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_components" ADD CONSTRAINT "product_recipe_components_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_components" ADD CONSTRAINT "product_recipe_components_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_variant_scope_fk" FOREIGN KEY ("company_id","product_variant_id") REFERENCES "public"."product_variants"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_recipe_components_recipe_idx" ON "product_recipe_components" USING btree ("company_id","recipe_id");--> statement-breakpoint
CREATE INDEX "product_recipe_components_variant_idx" ON "product_recipe_components" USING btree ("company_id","component_variant_id");--> statement-breakpoint
CREATE INDEX "product_recipes_company_variant_idx" ON "product_recipes" USING btree ("company_id","product_variant_id");--> statement-breakpoint
CREATE INDEX "product_recipes_company_active_idx" ON "product_recipes" USING btree ("company_id","product_variant_id") WHERE "product_recipes"."is_active" is true;