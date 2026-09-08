CREATE TABLE "access_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"sale_id" uuid,
	"customer_id" uuid,
	"allows_reentry" text DEFAULT 'false' NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"currently_inside" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	CONSTRAINT "access_credentials_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "access_credentials_code_nonblank_ck" CHECK (length(btrim("access_credentials"."code")) > 0),
	CONSTRAINT "access_credentials_status_ck" CHECK ("access_credentials"."status" in ('issued', 'void')),
	CONSTRAINT "access_credentials_allows_reentry_ck" CHECK ("access_credentials"."allows_reentry" in ('true', 'false')),
	CONSTRAINT "access_credentials_currently_inside_ck" CHECK ("access_credentials"."currently_inside" in ('true', 'false')),
	CONSTRAINT "access_credentials_voided_fields_ck" CHECK (("access_credentials"."status" = 'void') = ("access_credentials"."voided_at" is not null and "access_credentials"."voided_by" is not null)),
	CONSTRAINT "access_credentials_void_not_inside_ck" CHECK ("access_credentials"."status" <> 'void' or "access_credentials"."currently_inside" = 'false')
);
--> statement-breakpoint
CREATE TABLE "access_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_events_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "access_events_type_ck" CHECK ("access_events"."event_type" in ('entry', 'exit'))
);
--> statement-breakpoint
CREATE TABLE "cash_session_partial_closes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cash_session_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"opening_amount" numeric(19, 4) NOT NULL,
	"cash_sales_total" numeric(19, 4) NOT NULL,
	"cash_in_total" numeric(19, 4) NOT NULL,
	"cash_out_total" numeric(19, 4) NOT NULL,
	"expected_cash" numeric(19, 4) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_session_partial_closes_company_id_id_uq" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "employee_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"scheduled_start" time,
	"scheduled_end" time,
	"is_day_off" text DEFAULT 'false' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_schedules_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "employee_schedules_is_day_off_ck" CHECK ("employee_schedules"."is_day_off" in ('true', 'false')),
	CONSTRAINT "employee_schedules_range_ck" CHECK (("employee_schedules"."is_day_off" = 'true' and "employee_schedules"."scheduled_start" is null and "employee_schedules"."scheduled_end" is null)
        or ("employee_schedules"."is_day_off" = 'false' and "employee_schedules"."scheduled_start" is not null and "employee_schedules"."scheduled_end" is not null
            and "employee_schedules"."scheduled_end" > "employee_schedules"."scheduled_start"))
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"phone" text,
	"email" text,
	"job_title" text,
	"status" text DEFAULT 'active' NOT NULL,
	"hire_date" date,
	"weekly_salary" numeric(19, 4) DEFAULT 0 NOT NULL,
	"currency_code" char(3) NOT NULL,
	"user_id" uuid,
	"notes" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deactivated_by" uuid,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "employees_company_branch_id_uq" UNIQUE("company_id","branch_id","id"),
	CONSTRAINT "employees_code_nonblank_ck" CHECK (length(btrim("employees"."code")) > 0),
	CONSTRAINT "employees_display_name_nonblank_ck" CHECK (length(btrim("employees"."display_name")) > 0),
	CONSTRAINT "employees_status_ck" CHECK ("employees"."status" in ('active', 'inactive')),
	CONSTRAINT "employees_weekly_salary_nonnegative_ck" CHECK ("employees"."weekly_salary" >= 0),
	CONSTRAINT "employees_currency_code_ck" CHECK ("employees"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "employees_version_ck" CHECK ("employees"."version" >= 1),
	CONSTRAINT "employees_deactivation_fields_ck" CHECK (("employees"."status" = 'inactive') = ("employees"."deactivated_at" is not null and "employees"."deactivated_by" is not null)
        or ("employees"."status" = 'active' and "employees"."deactivated_at" is null and "employees"."deactivated_by" is null))
);
--> statement-breakpoint
CREATE TABLE "payroll_period_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"payroll_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"scheduled_minutes" integer DEFAULT 0 NOT NULL,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"base_salary_snapshot" numeric(19, 4) NOT NULL,
	"deduction_amount" numeric(19, 4) DEFAULT 0 NOT NULL,
	"bonus_amount" numeric(19, 4) DEFAULT 0 NOT NULL,
	"total_amount" numeric(19, 4) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"computed_by" uuid NOT NULL,
	CONSTRAINT "payroll_period_lines_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "payroll_period_lines_scheduled_minutes_ck" CHECK ("payroll_period_lines"."scheduled_minutes" >= 0),
	CONSTRAINT "payroll_period_lines_worked_minutes_ck" CHECK ("payroll_period_lines"."worked_minutes" >= 0),
	CONSTRAINT "payroll_period_lines_late_minutes_ck" CHECK ("payroll_period_lines"."late_minutes" >= 0),
	CONSTRAINT "payroll_period_lines_overtime_minutes_ck" CHECK ("payroll_period_lines"."overtime_minutes" >= 0),
	CONSTRAINT "payroll_period_lines_base_salary_ck" CHECK ("payroll_period_lines"."base_salary_snapshot" >= 0),
	CONSTRAINT "payroll_period_lines_deduction_ck" CHECK ("payroll_period_lines"."deduction_amount" >= 0),
	CONSTRAINT "payroll_period_lines_bonus_ck" CHECK ("payroll_period_lines"."bonus_amount" >= 0),
	CONSTRAINT "payroll_period_lines_total_nonnegative_ck" CHECK ("payroll_period_lines"."total_amount" >= 0),
	CONSTRAINT "payroll_period_lines_currency_code_ck" CHECK ("payroll_period_lines"."currency_code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_periods_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "payroll_periods_status_ck" CHECK ("payroll_periods"."status" in ('draft', 'closed')),
	CONSTRAINT "payroll_periods_range_ck" CHECK ("payroll_periods"."period_end" >= "payroll_periods"."period_start"),
	CONSTRAINT "payroll_periods_closed_fields_ck" CHECK (("payroll_periods"."status" = 'closed') = ("payroll_periods"."closed_at" is not null and "payroll_periods"."closed_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "time_clock_punches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"punch_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"station" text,
	"is_correction" text DEFAULT 'false' NOT NULL,
	"correction_reason" text,
	"corrected_punch_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_clock_punches_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "time_clock_punches_type_ck" CHECK ("time_clock_punches"."punch_type" in ('clock_in', 'clock_out')),
	CONSTRAINT "time_clock_punches_is_correction_ck" CHECK ("time_clock_punches"."is_correction" in ('true', 'false')),
	CONSTRAINT "time_clock_punches_correction_fields_ck" CHECK (("time_clock_punches"."is_correction" = 'true') = ("time_clock_punches"."correction_reason" is not null and "time_clock_punches"."corrected_punch_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "suppliers_name_nonblank_ck" CHECK (length(btrim("suppliers"."name")) > 0),
	CONSTRAINT "suppliers_status_ck" CHECK ("suppliers"."status" in ('active', 'inactive')),
	CONSTRAINT "suppliers_email_format_ck" CHECK ("suppliers"."email" is null or "suppliers"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "direct_purchases" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_sale_scope_fk" FOREIGN KEY ("company_id","branch_id","sale_id") REFERENCES "public"."sales"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_customer_scope_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_issued_by_membership_fk" FOREIGN KEY ("company_id","issued_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_voided_by_membership_fk" FOREIGN KEY ("company_id","voided_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_credential_scope_fk" FOREIGN KEY ("company_id","credential_id") REFERENCES "public"."access_credentials"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session_partial_closes" ADD CONSTRAINT "cash_session_partial_closes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session_partial_closes" ADD CONSTRAINT "cash_session_partial_closes_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session_partial_closes" ADD CONSTRAINT "cash_session_partial_closes_session_scope_fk" FOREIGN KEY ("company_id","cash_session_id") REFERENCES "public"."cash_sessions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session_partial_closes" ADD CONSTRAINT "cash_session_partial_closes_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_employee_scope_fk" FOREIGN KEY ("company_id","branch_id","employee_id") REFERENCES "public"."employees"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_scope_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_deactivated_by_membership_fk" FOREIGN KEY ("company_id","deactivated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period_lines" ADD CONSTRAINT "payroll_period_lines_period_scope_fk" FOREIGN KEY ("company_id","payroll_period_id") REFERENCES "public"."payroll_periods"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period_lines" ADD CONSTRAINT "payroll_period_lines_employee_scope_fk" FOREIGN KEY ("company_id","employee_id") REFERENCES "public"."employees"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period_lines" ADD CONSTRAINT "payroll_period_lines_computed_by_membership_fk" FOREIGN KEY ("company_id","computed_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_closed_by_membership_fk" FOREIGN KEY ("company_id","closed_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_punches" ADD CONSTRAINT "time_clock_punches_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_punches" ADD CONSTRAINT "time_clock_punches_employee_scope_fk" FOREIGN KEY ("company_id","branch_id","employee_id") REFERENCES "public"."employees"("company_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_punches" ADD CONSTRAINT "time_clock_punches_corrected_punch_scope_fk" FOREIGN KEY ("company_id","corrected_punch_id") REFERENCES "public"."time_clock_punches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_punches" ADD CONSTRAINT "time_clock_punches_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_membership_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_updated_by_membership_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."company_memberships"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_credentials_company_code_uq" ON "access_credentials" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "access_credentials_company_branch_idx" ON "access_credentials" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "access_credentials_company_branch_inside_idx" ON "access_credentials" USING btree ("company_id","branch_id","currently_inside");--> statement-breakpoint
CREATE INDEX "access_events_company_credential_idx" ON "access_events" USING btree ("company_id","credential_id","occurred_at");--> statement-breakpoint
CREATE INDEX "access_events_company_branch_occurred_idx" ON "access_events" USING btree ("company_id","branch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cash_session_partial_closes_company_session_idx" ON "cash_session_partial_closes" USING btree ("company_id","cash_session_id","taken_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_schedules_employee_date_uq" ON "employee_schedules" USING btree ("company_id","employee_id","work_date");--> statement-breakpoint
CREATE INDEX "employee_schedules_company_employee_idx" ON "employee_schedules" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_schedules_company_date_idx" ON "employee_schedules" USING btree ("company_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_company_code_uq" ON "employees" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "employees_company_branch_idx" ON "employees" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "employees_company_status_idx" ON "employees" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_period_lines_period_employee_uq" ON "payroll_period_lines" USING btree ("company_id","payroll_period_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_period_lines_company_period_idx" ON "payroll_period_lines" USING btree ("company_id","payroll_period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_periods_branch_range_uq" ON "payroll_periods" USING btree ("company_id","branch_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "payroll_periods_company_branch_idx" ON "payroll_periods" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "time_clock_punches_company_employee_idx" ON "time_clock_punches" USING btree ("company_id","employee_id","occurred_at");--> statement-breakpoint
CREATE INDEX "time_clock_punches_company_branch_idx" ON "time_clock_punches" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_company_name_uq" ON "suppliers" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "suppliers_company_status_idx" ON "suppliers" USING btree ("company_id","status");--> statement-breakpoint
ALTER TABLE "direct_purchases" ADD CONSTRAINT "direct_purchases_supplier_scope_fk" FOREIGN KEY ("company_id","supplier_id") REFERENCES "public"."suppliers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "direct_purchases_company_supplier_idx" ON "direct_purchases" USING btree ("company_id","supplier_id");--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_category_ck" CHECK ("cash_movements"."category" is null or "cash_movements"."category" in ('withdrawal', 'expense', 'external_income', 'other'));--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_category_direction_ck" CHECK ("cash_movements"."category" is null
        or "cash_movements"."category" = 'other'
        or ("cash_movements"."category" in ('withdrawal', 'expense') and "cash_movements"."movement_type" = 'cash_out')
        or ("cash_movements"."category" = 'external_income' and "cash_movements"."movement_type" = 'cash_in'));