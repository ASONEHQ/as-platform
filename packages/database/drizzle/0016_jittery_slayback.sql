CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cash_session_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"reference_type" text,
	"reference_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"device_id" uuid,
	"reversal_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_movements_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "cash_movements_type_ck" CHECK ("cash_movements"."movement_type" in ('opening_float','cash_sale','cash_in','cash_out')),
	CONSTRAINT "cash_movements_amount_positive_ck" CHECK ("cash_movements"."amount" > 0),
	CONSTRAINT "cash_movements_currency_code_ck" CHECK ("cash_movements"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "cash_movements_reason_code_nonblank_ck" CHECK (length(btrim("cash_movements"."reason_code")) > 0),
	CONSTRAINT "cash_movements_not_self_reversal_ck" CHECK ("cash_movements"."reversal_of_id" is null or "cash_movements"."reversal_of_id" <> "cash_movements"."id"),
	CONSTRAINT "cash_movements_reference_pair_ck" CHECK (("cash_movements"."reference_type" is null) = ("cash_movements"."reference_id" is null))
);
--> statement-breakpoint
CREATE TABLE "cash_registers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"device_id" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "cash_registers_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "cash_registers_company_branch_id_uq" UNIQUE("company_id","branch_id","id"),
	CONSTRAINT "cash_registers_code_nonblank_ck" CHECK (length(btrim("cash_registers"."code")) > 0),
	CONSTRAINT "cash_registers_normalized_code_ck" CHECK (length("cash_registers"."normalized_code") > 0 and "cash_registers"."normalized_code" = lower(btrim("cash_registers"."normalized_code"))),
	CONSTRAINT "cash_registers_name_nonblank_ck" CHECK (length(btrim("cash_registers"."name")) > 0),
	CONSTRAINT "cash_registers_status_ck" CHECK ("cash_registers"."status" in ('active','inactive','retired')),
	CONSTRAINT "cash_registers_version_ck" CHECK ("cash_registers"."version" >= 1),
	CONSTRAINT "cash_registers_retirement_ck" CHECK (("cash_registers"."status" = 'retired' and "cash_registers"."deleted_at" is not null)
        or ("cash_registers"."status" <> 'retired' and "cash_registers"."deleted_at" is null))
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cash_register_id" uuid NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"opening_amount" numeric(19, 4) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"declared_closing_amount" numeric(19, 4),
	"expected_closing_amount" numeric(19, 4),
	"discrepancy_amount" numeric(19, 4),
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_sessions_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "cash_sessions_company_branch_id_uq" UNIQUE("company_id","branch_id","id"),
	CONSTRAINT "cash_sessions_status_ck" CHECK ("cash_sessions"."status" in ('open','closing','closed')),
	CONSTRAINT "cash_sessions_currency_code_ck" CHECK ("cash_sessions"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "cash_sessions_opening_amount_ck" CHECK ("cash_sessions"."opening_amount" >= 0),
	CONSTRAINT "cash_sessions_declared_amount_ck" CHECK ("cash_sessions"."declared_closing_amount" is null or "cash_sessions"."declared_closing_amount" >= 0),
	CONSTRAINT "cash_sessions_version_ck" CHECK ("cash_sessions"."version" >= 1),
	CONSTRAINT "cash_sessions_closure_fields_ck" CHECK (("cash_sessions"."status" <> 'closed'
          and "cash_sessions"."closed_at" is null and "cash_sessions"."closed_by" is null
          and "cash_sessions"."declared_closing_amount" is null and "cash_sessions"."expected_closing_amount" is null
          and "cash_sessions"."discrepancy_amount" is null)
        or ("cash_sessions"."status" = 'closed'
          and "cash_sessions"."closed_at" is not null and "cash_sessions"."closed_by" is not null
          and "cash_sessions"."declared_closing_amount" is not null and "cash_sessions"."expected_closing_amount" is not null
          and "cash_sessions"."discrepancy_amount" is not null))
);
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_session_scope_fk" FOREIGN KEY ("company_id","cash_session_id") REFERENCES "public"."cash_sessions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_reversal_of_scope_fk" FOREIGN KEY ("company_id","reversal_of_id") REFERENCES "public"."cash_movements"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_device_scope_fk" FOREIGN KEY ("company_id","device_id") REFERENCES "public"."devices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_register_scope_fk" FOREIGN KEY ("company_id","branch_id","cash_register_id") REFERENCES "public"."cash_registers"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_opened_by_membership_fk" FOREIGN KEY ("company_id","opened_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_membership_fk" FOREIGN KEY ("company_id","closed_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_movements_sale_reference_uq" ON "cash_movements" USING btree ("company_id","reference_id") WHERE "cash_movements"."reference_type" = 'sale';--> statement-breakpoint
CREATE INDEX "cash_movements_company_session_idx" ON "cash_movements" USING btree ("company_id","cash_session_id");--> statement-breakpoint
CREATE INDEX "cash_movements_company_branch_idx" ON "cash_movements" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "cash_movements_company_type_idx" ON "cash_movements" USING btree ("company_id","movement_type");--> statement-breakpoint
CREATE INDEX "cash_movements_session_occurred_idx" ON "cash_movements" USING btree ("company_id","cash_session_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "cash_movements_company_reference_idx" ON "cash_movements" USING btree ("company_id","reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_registers_company_branch_code_active_uq" ON "cash_registers" USING btree ("company_id","branch_id","normalized_code") WHERE "cash_registers"."status" <> 'retired' and "cash_registers"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "cash_registers_company_branch_idx" ON "cash_registers" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "cash_registers_company_status_idx" ON "cash_registers" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_register_active_uq" ON "cash_sessions" USING btree ("company_id","cash_register_id") WHERE "cash_sessions"."status" in ('open','closing');--> statement-breakpoint
CREATE INDEX "cash_sessions_company_branch_idx" ON "cash_sessions" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "cash_sessions_company_register_idx" ON "cash_sessions" USING btree ("company_id","cash_register_id");--> statement-breakpoint
CREATE INDEX "cash_sessions_company_status_idx" ON "cash_sessions" USING btree ("company_id","status");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_register_scope_fk" FOREIGN KEY ("company_id","branch_id","cash_register_id") REFERENCES "public"."cash_registers"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_session_scope_fk" FOREIGN KEY ("company_id","branch_id","cash_session_id") REFERENCES "public"."cash_sessions"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;