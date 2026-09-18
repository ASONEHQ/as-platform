CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"ordered_quantity" numeric(19, 6) NOT NULL,
	"received_quantity" numeric(19, 6) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(19, 4) NOT NULL,
	"line_total" numeric(19, 4) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_lines_company_order_line_uq" UNIQUE("company_id","purchase_order_id","line_number"),
	CONSTRAINT "purchase_order_lines_company_order_variant_uq" UNIQUE("company_id","purchase_order_id","product_variant_id"),
	CONSTRAINT "purchase_order_lines_line_number_ck" CHECK ("purchase_order_lines"."line_number" >= 1),
	CONSTRAINT "purchase_order_lines_ordered_quantity_ck" CHECK ("purchase_order_lines"."ordered_quantity" > 0),
	CONSTRAINT "purchase_order_lines_received_quantity_ck" CHECK ("purchase_order_lines"."received_quantity" >= 0 and "purchase_order_lines"."received_quantity" <= "purchase_order_lines"."ordered_quantity"),
	CONSTRAINT "purchase_order_lines_unit_cost_nonnegative_ck" CHECK ("purchase_order_lines"."unit_cost" >= 0),
	CONSTRAINT "purchase_order_lines_line_total_nonnegative_ck" CHECK ("purchase_order_lines"."line_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"supplier_name" text,
	"supplier_id" uuid,
	"order_date" text NOT NULL,
	"expected_date" text,
	"currency_code" text NOT NULL,
	"total_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"received_at" timestamp with time zone,
	"received_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"receipt_movement_id" uuid,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "purchase_orders_company_number_uq" UNIQUE("company_id","order_number"),
	CONSTRAINT "purchase_orders_order_number_nonblank_ck" CHECK (length(btrim("purchase_orders"."order_number")) > 0),
	CONSTRAINT "purchase_orders_status_ck" CHECK ("purchase_orders"."status" in ('draft','submitted','partially_received','received','cancelled')),
	CONSTRAINT "purchase_orders_currency_code_ck" CHECK ("purchase_orders"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "purchase_orders_total_cost_nonnegative_ck" CHECK ("purchase_orders"."total_cost" >= 0),
	CONSTRAINT "purchase_orders_version_ck" CHECK ("purchase_orders"."version" >= 1),
	CONSTRAINT "purchase_orders_lifecycle_ck" CHECK (("purchase_orders"."status" = 'draft'
          and "purchase_orders"."submitted_at" is null and "purchase_orders"."submitted_by" is null
          and "purchase_orders"."received_at" is null and "purchase_orders"."received_by" is null
          and "purchase_orders"."cancelled_at" is null and "purchase_orders"."cancelled_by" is null
          and "purchase_orders"."receipt_movement_id" is null)
        or ("purchase_orders"."status" = 'submitted'
          and "purchase_orders"."submitted_at" is not null and "purchase_orders"."submitted_by" is not null
          and "purchase_orders"."received_at" is null and "purchase_orders"."received_by" is null
          and "purchase_orders"."cancelled_at" is null and "purchase_orders"."cancelled_by" is null
          and "purchase_orders"."receipt_movement_id" is null)
        or ("purchase_orders"."status" = 'partially_received'
          and "purchase_orders"."submitted_at" is not null and "purchase_orders"."submitted_by" is not null
          and "purchase_orders"."received_at" is not null and "purchase_orders"."received_by" is not null
          and "purchase_orders"."cancelled_at" is null and "purchase_orders"."cancelled_by" is null
          and "purchase_orders"."receipt_movement_id" is not null)
        or ("purchase_orders"."status" = 'received'
          and "purchase_orders"."submitted_at" is not null and "purchase_orders"."submitted_by" is not null
          and "purchase_orders"."received_at" is not null and "purchase_orders"."received_by" is not null
          and "purchase_orders"."cancelled_at" is null and "purchase_orders"."cancelled_by" is null
          and "purchase_orders"."receipt_movement_id" is not null)
        or ("purchase_orders"."status" = 'cancelled'
          and "purchase_orders"."cancelled_at" is not null and "purchase_orders"."cancelled_by" is not null
          and ("purchase_orders"."received_at" is null) = ("purchase_orders"."receipt_movement_id" is null)
          and ("purchase_orders"."received_by" is null) = ("purchase_orders"."receipt_movement_id" is null)))
);
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_scope_fk" FOREIGN KEY ("company_id","purchase_order_id") REFERENCES "public"."purchase_orders"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_variant_scope_fk" FOREIGN KEY ("company_id","product_variant_id") REFERENCES "public"."product_variants"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_scope_fk" FOREIGN KEY ("company_id","supplier_id") REFERENCES "public"."suppliers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_receipt_movement_scope_fk" FOREIGN KEY ("company_id","receipt_movement_id") REFERENCES "public"."inventory_movements"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_submitted_by_membership_fk" FOREIGN KEY ("company_id","submitted_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_received_by_membership_fk" FOREIGN KEY ("company_id","received_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cancelled_by_membership_fk" FOREIGN KEY ("company_id","cancelled_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_lines_order_idx" ON "purchase_order_lines" USING btree ("company_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_variant_idx" ON "purchase_order_lines" USING btree ("company_id","product_variant_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_company_branch_idx" ON "purchase_orders" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_company_status_idx" ON "purchase_orders" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "purchase_orders_company_supplier_idx" ON "purchase_orders" USING btree ("company_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_company_order_date_idx" ON "purchase_orders" USING btree ("company_id","order_date");--> statement-breakpoint
CREATE INDEX "purchase_orders_company_receipt_movement_idx" ON "purchase_orders" USING btree ("company_id","receipt_movement_id");