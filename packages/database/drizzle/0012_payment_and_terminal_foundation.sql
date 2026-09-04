CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"terminal_id" uuid,
	"status" text DEFAULT 'created' NOT NULL,
	"provider_reference" text,
	"decline_reason" text,
	"metadata" jsonb,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "payment_attempts_payment_number_uq" UNIQUE("company_id","payment_id","attempt_number"),
	CONSTRAINT "payment_attempts_company_provider_reference_uq" UNIQUE("company_id","provider_reference"),
	CONSTRAINT "payment_attempts_attempt_number_ck" CHECK ("payment_attempts"."attempt_number" >= 1),
	CONSTRAINT "payment_attempts_status_ck" CHECK ("payment_attempts"."status" in ('created', 'awaiting_terminal', 'processing', 'approved', 'declined', 'cancelled', 'timed_out', 'failed')),
	CONSTRAINT "payment_attempts_responded_at_ck" CHECK ("payment_attempts"."status" not in ('approved', 'declined', 'cancelled', 'timed_out', 'failed') or "payment_attempts"."responded_at" is not null),
	CONSTRAINT "payment_attempts_version_ck" CHECK ("payment_attempts"."version" >= 1),
	CONSTRAINT "payment_attempts_metadata_object_ck" CHECK ("payment_attempts"."metadata" is null or jsonb_typeof("payment_attempts"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "payment_terminals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"provider" text DEFAULT 'unassigned' NOT NULL,
	"provider_terminal_id" text,
	"capabilities" jsonb,
	"status" text DEFAULT 'unassigned' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_terminals_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "payment_terminals_company_device_uq" UNIQUE("company_id","device_id"),
	CONSTRAINT "payment_terminals_provider_nonblank_ck" CHECK (length(btrim("payment_terminals"."provider")) > 0),
	CONSTRAINT "payment_terminals_status_ck" CHECK ("payment_terminals"."status" in ('unassigned', 'assigned', 'active', 'disabled')),
	CONSTRAINT "payment_terminals_capabilities_object_ck" CHECK ("payment_terminals"."capabilities" is null or jsonb_typeof("payment_terminals"."capabilities") = 'object'),
	CONSTRAINT "payment_terminals_version_ck" CHECK ("payment_terminals"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_reference" uuid,
	"payment_method" text NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"provider" text,
	"terminal_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason_code" text,
	"metadata" jsonb,
	"created_by" uuid NOT NULL,
	"authorized_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "payments_amount_positive_ck" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_currency_code_ck" CHECK ("payments"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_method_ck" CHECK ("payments"."payment_method" in ('cash', 'card_terminal', 'card_manual', 'other')),
	CONSTRAINT "payments_status_ck" CHECK ("payments"."status" in ('pending', 'authorized', 'captured', 'failed', 'reversed')),
	CONSTRAINT "payments_terminal_required_ck" CHECK (("payments"."payment_method" = 'card_terminal') = ("payments"."terminal_id" is not null)),
	CONSTRAINT "payments_authorized_at_ck" CHECK ("payments"."status" <> 'authorized' or "payments"."authorized_at" is not null),
	CONSTRAINT "payments_captured_at_ck" CHECK ("payments"."status" <> 'captured' or "payments"."captured_at" is not null),
	CONSTRAINT "payments_failed_at_ck" CHECK ("payments"."status" <> 'failed' or "payments"."failed_at" is not null),
	CONSTRAINT "payments_reversed_at_ck" CHECK ("payments"."status" <> 'reversed' or "payments"."reversed_at" is not null),
	CONSTRAINT "payments_version_ck" CHECK ("payments"."version" >= 1),
	CONSTRAINT "payments_metadata_object_ck" CHECK ("payments"."metadata" is null or jsonb_typeof("payments"."metadata") = 'object')
);
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_type_ck";--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_branch_required_ck";--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_scope_fk" FOREIGN KEY ("company_id","payment_id") REFERENCES "public"."payments"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_terminal_scope_fk" FOREIGN KEY ("company_id","terminal_id") REFERENCES "public"."payment_terminals"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_terminals" ADD CONSTRAINT "payment_terminals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_terminals" ADD CONSTRAINT "payment_terminals_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_terminals" ADD CONSTRAINT "payment_terminals_device_scope_fk" FOREIGN KEY ("company_id","device_id") REFERENCES "public"."devices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_terminal_scope_fk" FOREIGN KEY ("company_id","terminal_id") REFERENCES "public"."payment_terminals"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_attempts_payment_idx" ON "payment_attempts" USING btree ("company_id","payment_id");--> statement-breakpoint
CREATE INDEX "payment_attempts_status_idx" ON "payment_attempts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "payment_terminals_company_branch_idx" ON "payment_terminals" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "payment_terminals_company_status_idx" ON "payment_terminals" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "payments_company_branch_idx" ON "payments" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "payments_company_status_idx" ON "payments" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "payments_company_sale_reference_idx" ON "payments" USING btree ("company_id","sale_reference");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_type_ck" CHECK ("devices"."device_type" in ('pos', 'kiosk', 'admin', 'worker', 'display', 'card_terminal', 'other'));--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_branch_required_ck" CHECK ("devices"."device_type" not in ('pos', 'kiosk', 'display', 'card_terminal') or "devices"."branch_id" is not null);