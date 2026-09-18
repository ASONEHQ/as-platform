ALTER TABLE "purchase_order_lines" ADD COLUMN "product_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "variant_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "sku_snapshot" text;--> statement-breakpoint
UPDATE "purchase_order_lines" pol
  SET "product_name_snapshot" = p.name,
      "variant_name_snapshot" = pv.name,
      "sku_snapshot" = pv.sku
  FROM "product_variants" pv
  JOIN "products" p ON p.company_id = pv.company_id AND p.id = pv.product_id
  WHERE pv.company_id = pol.company_id AND pv.id = pol.product_variant_id
    AND pol."product_name_snapshot" IS NULL;--> statement-breakpoint
UPDATE "purchase_order_lines" SET "product_name_snapshot" = 'Unknown product' WHERE "product_name_snapshot" IS NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ALTER COLUMN "product_name_snapshot" SET NOT NULL;
