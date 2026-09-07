CREATE TABLE "reward_entitlement_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"reward_entitlement_id" uuid NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "reward_entitlement_tokens_token_uq" UNIQUE("token"),
	CONSTRAINT "reward_entitlement_tokens_token_nonblank_ck" CHECK (length(btrim("reward_entitlement_tokens"."token")) >= 16),
	CONSTRAINT "reward_entitlement_tokens_status_ck" CHECK ("reward_entitlement_tokens"."status" in ('active', 'revoked')),
	CONSTRAINT "reward_entitlement_tokens_revoked_at_ck" CHECK (("reward_entitlement_tokens"."status" = 'revoked') = ("reward_entitlement_tokens"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "reward_entitlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"loyalty_account_id" uuid NOT NULL,
	"loyalty_program_id" uuid NOT NULL,
	"reward_type" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" uuid,
	"redeemed_branch_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_reason" text,
	"source_type" text NOT NULL,
	"source_ledger_entry_id" uuid,
	"cycle_number" integer,
	"created_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_entitlements_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "reward_entitlements_company_account_program_cycle_uq" UNIQUE("company_id","loyalty_account_id","loyalty_program_id","cycle_number"),
	CONSTRAINT "reward_entitlements_reward_type_ck" CHECK ("reward_entitlements"."reward_type" in ('vip_pass')),
	CONSTRAINT "reward_entitlements_status_ck" CHECK ("reward_entitlements"."status" in ('available', 'redeemed', 'expired', 'revoked')),
	CONSTRAINT "reward_entitlements_source_type_ck" CHECK ("reward_entitlements"."source_type" in ('loyalty_threshold', 'manual')),
	CONSTRAINT "reward_entitlements_cycle_pair_ck" CHECK (("reward_entitlements"."source_type" = 'loyalty_threshold') = ("reward_entitlements"."cycle_number" is not null)),
	CONSTRAINT "reward_entitlements_cycle_number_ck" CHECK ("reward_entitlements"."cycle_number" is null or "reward_entitlements"."cycle_number" > 0),
	CONSTRAINT "reward_entitlements_redeemed_ck" CHECK (("reward_entitlements"."status" = 'redeemed') = ("reward_entitlements"."redeemed_at" is not null and "reward_entitlements"."redeemed_by" is not null)),
	CONSTRAINT "reward_entitlements_revoked_ck" CHECK (("reward_entitlements"."status" = 'revoked') = ("reward_entitlements"."revoked_at" is not null and "reward_entitlements"."revoked_by" is not null and "reward_entitlements"."revoked_reason" is not null and length(btrim("reward_entitlements"."revoked_reason")) > 0)),
	CONSTRAINT "reward_entitlements_version_ck" CHECK ("reward_entitlements"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD COLUMN "reward_type" text;--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD COLUMN "reward_expiration_days" integer;--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD COLUMN "reward_repeatable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_company_id_id_uq" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "reward_entitlement_tokens" ADD CONSTRAINT "reward_entitlement_tokens_entitlement_scope_fk" FOREIGN KEY ("company_id","reward_entitlement_id") REFERENCES "public"."reward_entitlements"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_customer_scope_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_account_scope_fk" FOREIGN KEY ("company_id","loyalty_account_id") REFERENCES "public"."loyalty_accounts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_program_scope_fk" FOREIGN KEY ("company_id","loyalty_program_id") REFERENCES "public"."loyalty_programs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_source_ledger_entry_scope_fk" FOREIGN KEY ("company_id","source_ledger_entry_id") REFERENCES "public"."loyalty_ledger"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_redeemed_branch_scope_fk" FOREIGN KEY ("company_id","redeemed_branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_redeemed_by_membership_fk" FOREIGN KEY ("company_id","redeemed_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_revoked_by_membership_fk" FOREIGN KEY ("company_id","revoked_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entitlements" ADD CONSTRAINT "reward_entitlements_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reward_entitlement_tokens_entitlement_idx" ON "reward_entitlement_tokens" USING btree ("company_id","reward_entitlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_entitlement_tokens_company_entitlement_active_uq" ON "reward_entitlement_tokens" USING btree ("company_id","reward_entitlement_id") WHERE "reward_entitlement_tokens"."status" = 'active';--> statement-breakpoint
CREATE INDEX "reward_entitlements_customer_idx" ON "reward_entitlements" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "reward_entitlements_company_status_idx" ON "reward_entitlements" USING btree ("company_id","status");--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_reward_type_ck" CHECK ("loyalty_programs"."reward_type" is null or "loyalty_programs"."reward_type" in ('vip_pass'));--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_reward_expiration_days_ck" CHECK ("loyalty_programs"."reward_expiration_days" is null or "loyalty_programs"."reward_expiration_days" > 0);--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_reward_pair_ck" CHECK (("loyalty_programs"."reward_threshold" is null) = ("loyalty_programs"."reward_type" is null));