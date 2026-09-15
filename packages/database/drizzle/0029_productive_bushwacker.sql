ALTER TABLE "product_variants" ADD COLUMN "min_stock" numeric(19, 6);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "icon_key" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "card_style" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "card_color_hex" char(7);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "preferred_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_preferred_supplier_scope_fk" FOREIGN KEY ("company_id","preferred_supplier_id") REFERENCES "public"."suppliers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_company_supplier_idx" ON "products" USING btree ("company_id","preferred_supplier_id");--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_min_stock_ck" CHECK ("product_variants"."min_stock" is null or "product_variants"."min_stock" >= 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_card_style_ck" CHECK ("products"."card_style" in ('default', 'gradient', 'solid'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_card_color_hex_ck" CHECK ("products"."card_color_hex" is null or "products"."card_color_hex" ~ '^#[0-9A-Fa-f]{6}$');--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_card_style_color_ck" CHECK ("products"."card_style" = 'default' or "products"."card_color_hex" is not null);