CREATE TABLE "payroll_period_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "payroll_period_adjustments_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "payroll_period_adjustments_kind_ck" CHECK ("payroll_period_adjustments"."kind" in ('bonus', 'deduction')),
	CONSTRAINT "payroll_period_adjustments_amount_ck" CHECK ("payroll_period_adjustments"."amount" > 0),
	CONSTRAINT "payroll_period_adjustments_currency_code_ck" CHECK ("payroll_period_adjustments"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payroll_period_adjustments_reason_ck" CHECK (char_length(btrim("payroll_period_adjustments"."reason")) between 3 and 500),
	CONSTRAINT "payroll_period_adjustments_void_fields_ck" CHECK (("payroll_period_adjustments"."voided_at" is null) = ("payroll_period_adjustments"."voided_by" is null) and ("payroll_period_adjustments"."voided_at" is null) = ("payroll_period_adjustments"."void_reason" is null)),
	CONSTRAINT "payroll_period_adjustments_void_reason_ck" CHECK ("payroll_period_adjustments"."void_reason" is null or char_length(btrim("payroll_period_adjustments"."void_reason")) between 3 and 500)
);
--> statement-breakpoint
CREATE TABLE "payroll_period_line_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"scheduled_start" time,
	"scheduled_end" time,
	"is_day_off" boolean DEFAULT false NOT NULL,
	"scheduled_minutes" integer DEFAULT 0 NOT NULL,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"first_in_minute" integer,
	"last_out_minute" integer,
	"attendance_state" text NOT NULL,
	CONSTRAINT "payroll_period_line_days_minutes_ck" CHECK ("payroll_period_line_days"."scheduled_minutes" >= 0 and "payroll_period_line_days"."worked_minutes" >= 0 and "payroll_period_line_days"."late_minutes" >= 0 and "payroll_period_line_days"."overtime_minutes" >= 0),
	CONSTRAINT "payroll_period_line_days_clock_minutes_ck" CHECK (("payroll_period_line_days"."first_in_minute" is null or "payroll_period_line_days"."first_in_minute" between 0 and 1439) and ("payroll_period_line_days"."last_out_minute" is null or "payroll_period_line_days"."last_out_minute" between 0 and 1439)),
	CONSTRAINT "payroll_period_line_days_state_ck" CHECK ("payroll_period_line_days"."attendance_state" in ('complete', 'unscheduled_work', 'missing_clock_out', 'missing_clock_in', 'no_punches', 'day_off', 'no_schedule'))
);
--> statement-breakpoint
ALTER TABLE "payroll_period_lines" ADD COLUMN "adjustment_amount" numeric(19, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_period_lines" ADD COLUMN "employee_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "payroll_period_lines" ADD COLUMN "employee_code_snapshot" text;--> statement-breakpoint
ALTER TABLE "payroll_period_lines" ADD COLUMN "job_title_snapshot" text;--> statement-breakpoint
ALTER TABLE "payroll_period_adjustments" ADD CONSTRAINT "payroll_period_adjustments_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period_adjustments" ADD CONSTRAINT "payroll_period_adjustments_period_scope_fk" FOREIGN KEY ("company_id","payroll_period_id") REFERENCES "public"."payroll_periods"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period_adjustments" ADD CONSTRAINT "payroll_period_adjustments_employee_scope_fk" FOREIGN KEY ("company_id","employee_id") REFERENCES "public"."employees"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period_adjustments" ADD CONSTRAINT "payroll_period_adjustments_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period_adjustments" ADD CONSTRAINT "payroll_period_adjustments_voided_by_membership_fk" FOREIGN KEY ("company_id","voided_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period_line_days" ADD CONSTRAINT "payroll_period_line_days_period_scope_fk" FOREIGN KEY ("company_id","payroll_period_id") REFERENCES "public"."payroll_periods"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period_line_days" ADD CONSTRAINT "payroll_period_line_days_employee_scope_fk" FOREIGN KEY ("company_id","employee_id") REFERENCES "public"."employees"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_period_adjustments_period_employee_idx" ON "payroll_period_adjustments" USING btree ("company_id","payroll_period_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_period_line_days_period_employee_date_uq" ON "payroll_period_line_days" USING btree ("company_id","payroll_period_id","employee_id","work_date");