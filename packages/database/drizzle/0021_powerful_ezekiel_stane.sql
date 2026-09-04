CREATE TABLE "customer_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"membership_plan_id" uuid NOT NULL,
	"membership_number" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_sale_id" uuid,
	"renewed_from_membership_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"created_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_memberships_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "customer_memberships_company_number_uq" UNIQUE("company_id","membership_number"),
	CONSTRAINT "customer_memberships_company_sale_plan_uq" UNIQUE("company_id","source_sale_id","membership_plan_id"),
	CONSTRAINT "customer_memberships_status_ck" CHECK ("customer_memberships"."status" in ('pending', 'active', 'expired', 'cancelled')),
	CONSTRAINT "customer_memberships_number_nonblank_ck" CHECK (length(btrim("customer_memberships"."membership_number")) > 0),
	CONSTRAINT "customer_memberships_window_ck" CHECK ("customer_memberships"."expires_at" is null or "customer_memberships"."starts_at" < "customer_memberships"."expires_at"),
	CONSTRAINT "customer_memberships_cancelled_ck" CHECK (("customer_memberships"."status" = 'cancelled') = ("customer_memberships"."cancelled_at" is not null and "customer_memberships"."cancelled_reason" is not null)),
	CONSTRAINT "customer_memberships_version_ck" CHECK ("customer_memberships"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "customer_qr_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "customer_qr_tokens_token_uq" UNIQUE("token"),
	CONSTRAINT "customer_qr_tokens_token_nonblank_ck" CHECK (length(btrim("customer_qr_tokens"."token")) >= 16),
	CONSTRAINT "customer_qr_tokens_status_ck" CHECK ("customer_qr_tokens"."status" in ('active', 'revoked')),
	CONSTRAINT "customer_qr_tokens_revoked_at_ck" CHECK (("customer_qr_tokens"."status" = 'revoked') = ("customer_qr_tokens"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"display_name" text NOT NULL,
	"email" text,
	"normalized_email" text,
	"phone" text,
	"normalized_phone" text,
	"phone_country_code" char(2),
	"birth_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "customers_company_normalized_email_uq" UNIQUE("company_id","normalized_email"),
	CONSTRAINT "customers_company_normalized_phone_uq" UNIQUE("company_id","normalized_phone"),
	CONSTRAINT "customers_first_name_nonblank_ck" CHECK (length(btrim("customers"."first_name")) > 0),
	CONSTRAINT "customers_display_name_nonblank_ck" CHECK (length(btrim("customers"."display_name")) > 0),
	CONSTRAINT "customers_status_ck" CHECK ("customers"."status" in ('active', 'inactive', 'archived')),
	CONSTRAINT "customers_normalized_email_ck" CHECK ("customers"."normalized_email" is null or (length("customers"."normalized_email") > 0 and "customers"."normalized_email" = lower(btrim("customers"."normalized_email")))),
	CONSTRAINT "customers_email_format_ck" CHECK ("customers"."email" is null or "customers"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
	CONSTRAINT "customers_normalized_phone_ck" CHECK ("customers"."normalized_phone" is null or "customers"."normalized_phone" ~ '^\+[1-9]\d{6,14}$'),
	CONSTRAINT "customers_phone_country_code_ck" CHECK ("customers"."phone_country_code" is null or "customers"."phone_country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "customers_birth_date_ck" CHECK ("customers"."birth_date" is null or "customers"."birth_date" <= current_date),
	CONSTRAINT "customers_version_ck" CHECK ("customers"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "loyalty_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_accounts_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "loyalty_accounts_company_customer_uq" UNIQUE("company_id","customer_id"),
	CONSTRAINT "loyalty_accounts_status_ck" CHECK ("loyalty_accounts"."status" in ('active', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"loyalty_account_id" uuid NOT NULL,
	"loyalty_program_id" uuid,
	"branch_id" uuid,
	"entry_type" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"reason" text,
	"actor_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_ledger_company_program_sale_uq" UNIQUE("company_id","loyalty_program_id","source_type","source_id"),
	CONSTRAINT "loyalty_ledger_entry_type_ck" CHECK ("loyalty_ledger"."entry_type" in ('earn', 'redeem', 'adjustment', 'expiration')),
	CONSTRAINT "loyalty_ledger_quantity_ck" CHECK ("loyalty_ledger"."quantity" <> 0),
	CONSTRAINT "loyalty_ledger_unit_type_ck" CHECK ("loyalty_ledger"."unit_type" in ('stamp', 'point')),
	CONSTRAINT "loyalty_ledger_source_type_ck" CHECK ("loyalty_ledger"."source_type" in ('sale', 'manual', 'expiration_job')),
	CONSTRAINT "loyalty_ledger_manual_fields_ck" CHECK (("loyalty_ledger"."source_type" <> 'manual') or ("loyalty_ledger"."reason" is not null and length(btrim("loyalty_ledger"."reason")) > 0 and "loyalty_ledger"."actor_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "loyalty_programs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"unit_type" text NOT NULL,
	"earning_rule_type" text DEFAULT 'per_completed_sale' NOT NULL,
	"earn_quantity_per_sale" integer DEFAULT 1 NOT NULL,
	"minimum_sale_total" numeric(19, 4),
	"reward_threshold" integer,
	"reward_description" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_programs_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "loyalty_programs_name_nonblank_ck" CHECK (length(btrim("loyalty_programs"."name")) > 0),
	CONSTRAINT "loyalty_programs_unit_type_ck" CHECK ("loyalty_programs"."unit_type" in ('stamp', 'point')),
	CONSTRAINT "loyalty_programs_earning_rule_type_ck" CHECK ("loyalty_programs"."earning_rule_type" in ('per_completed_sale')),
	CONSTRAINT "loyalty_programs_earn_quantity_ck" CHECK ("loyalty_programs"."earn_quantity_per_sale" > 0),
	CONSTRAINT "loyalty_programs_minimum_sale_total_ck" CHECK ("loyalty_programs"."minimum_sale_total" is null or "loyalty_programs"."minimum_sale_total" >= 0),
	CONSTRAINT "loyalty_programs_reward_threshold_ck" CHECK ("loyalty_programs"."reward_threshold" is null or "loyalty_programs"."reward_threshold" > 0),
	CONSTRAINT "loyalty_programs_version_ck" CHECK ("loyalty_programs"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "membership_plan_branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"membership_plan_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plan_branches_company_plan_branch_uq" UNIQUE("company_id","membership_plan_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"product_id" uuid,
	"duration_days" integer,
	"benefit_description" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plans_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "membership_plans_company_product_uq" UNIQUE("company_id","product_id"),
	CONSTRAINT "membership_plans_name_nonblank_ck" CHECK (length(btrim("membership_plans"."name")) > 0),
	CONSTRAINT "membership_plans_duration_days_ck" CHECK ("membership_plans"."duration_days" is null or "membership_plans"."duration_days" > 0),
	CONSTRAINT "membership_plans_version_ck" CHECK ("membership_plans"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "customer_display_name" text;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_customer_scope_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_plan_scope_fk" FOREIGN KEY ("company_id","membership_plan_id") REFERENCES "public"."membership_plans"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_renewed_from_scope_fk" FOREIGN KEY ("company_id","renewed_from_membership_id") REFERENCES "public"."customer_memberships"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_qr_tokens" ADD CONSTRAINT "customer_qr_tokens_customer_scope_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customer_scope_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_account_scope_fk" FOREIGN KEY ("company_id","loyalty_account_id") REFERENCES "public"."loyalty_accounts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_program_scope_fk" FOREIGN KEY ("company_id","loyalty_program_id") REFERENCES "public"."loyalty_programs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_actor_membership_fk" FOREIGN KEY ("company_id","actor_id") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan_branches" ADD CONSTRAINT "membership_plan_branches_plan_scope_fk" FOREIGN KEY ("company_id","membership_plan_id") REFERENCES "public"."membership_plans"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan_branches" ADD CONSTRAINT "membership_plan_branches_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_product_scope_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."products"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_memberships_customer_idx" ON "customer_memberships" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_memberships_company_status_idx" ON "customer_memberships" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "customer_qr_tokens_customer_idx" ON "customer_qr_tokens" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_qr_tokens_company_customer_active_uq" ON "customer_qr_tokens" USING btree ("company_id","customer_id") WHERE "customer_qr_tokens"."status" = 'active';--> statement-breakpoint
CREATE INDEX "customers_company_status_idx" ON "customers" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "customers_company_display_name_idx" ON "customers" USING btree ("company_id","display_name");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_account_occurred_idx" ON "loyalty_ledger" USING btree ("company_id","loyalty_account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_program_idx" ON "loyalty_ledger" USING btree ("company_id","loyalty_program_id");--> statement-breakpoint
CREATE INDEX "loyalty_programs_company_active_idx" ON "loyalty_programs" USING btree ("company_id","active");--> statement-breakpoint
CREATE INDEX "membership_plan_branches_plan_idx" ON "membership_plan_branches" USING btree ("company_id","membership_plan_id");--> statement-breakpoint
CREATE INDEX "membership_plans_company_active_idx" ON "membership_plans" USING btree ("company_id","active");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_scope_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_company_customer_idx" ON "sales" USING btree ("company_id","customer_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_display_name_ck" CHECK ("sales"."customer_id" is null or ("sales"."customer_display_name" is not null and length(btrim("sales"."customer_display_name")) > 0));