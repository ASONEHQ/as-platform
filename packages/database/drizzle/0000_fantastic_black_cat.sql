CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"request_id" text,
	"correlation_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_actor_type_ck" CHECK ("audit_log"."actor_type" in ('user', 'device', 'system')),
	CONSTRAINT "audit_log_action_nonblank_ck" CHECK (length(btrim("audit_log"."action")) > 0),
	CONSTRAINT "audit_log_entity_type_nonblank_ck" CHECK (length(btrim("audit_log"."entity_type")) > 0),
	CONSTRAINT "audit_log_metadata_object_ck" CHECK (jsonb_typeof("audit_log"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"resource_type" text,
	"resource_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_keys_company_operation_key_uq" UNIQUE("company_id","operation","key"),
	CONSTRAINT "idempotency_keys_key_nonblank_ck" CHECK (length(btrim("idempotency_keys"."key")) > 0),
	CONSTRAINT "idempotency_keys_operation_nonblank_ck" CHECK (length(btrim("idempotency_keys"."operation")) > 0),
	CONSTRAINT "idempotency_keys_request_hash_ck" CHECK (length(btrim("idempotency_keys"."request_hash")) >= 32),
	CONSTRAINT "idempotency_keys_response_status_ck" CHECK ("idempotency_keys"."response_status" is null or "idempotency_keys"."response_status" between 100 and 599),
	CONSTRAINT "idempotency_keys_response_body_size_ck" CHECK ("idempotency_keys"."response_body" is null or octet_length("idempotency_keys"."response_body"::text) <= 65536),
	CONSTRAINT "idempotency_keys_expiry_ck" CHECK ("idempotency_keys"."expires_at" > "idempotency_keys"."created_at"),
	CONSTRAINT "idempotency_keys_completed_at_ck" CHECK ("idempotency_keys"."completed_at" is null or ("idempotency_keys"."completed_at" >= "idempotency_keys"."created_at" and "idempotency_keys"."completed_at" <= "idempotency_keys"."expires_at"))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"event_type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" bigint NOT NULL,
	"correlation_id" text,
	"causation_id" uuid,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_type_nonblank_ck" CHECK (length(btrim("outbox_events"."event_type")) > 0),
	CONSTRAINT "outbox_events_schema_version_ck" CHECK ("outbox_events"."schema_version" > 0),
	CONSTRAINT "outbox_events_aggregate_type_nonblank_ck" CHECK (length(btrim("outbox_events"."aggregate_type")) > 0),
	CONSTRAINT "outbox_events_aggregate_version_ck" CHECK ("outbox_events"."aggregate_version" > 0),
	CONSTRAINT "outbox_events_attempts_ck" CHECK ("outbox_events"."attempts" >= 0),
	CONSTRAINT "outbox_events_payload_ck" CHECK (jsonb_typeof("outbox_events"."payload") = 'object' and "outbox_events"."payload" <> '{}'::jsonb),
	CONSTRAINT "outbox_events_publication_time_ck" CHECK ("outbox_events"."published_at" is null or "outbox_events"."published_at" >= "outbox_events"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" text NOT NULL,
	"device_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"public_key" text,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "devices_name_nonblank_ck" CHECK (length(btrim("devices"."name")) > 0),
	CONSTRAINT "devices_type_ck" CHECK ("devices"."device_type" in ('pos', 'kiosk', 'admin', 'worker', 'display', 'other')),
	CONSTRAINT "devices_status_ck" CHECK ("devices"."status" in ('pending', 'active', 'revoked', 'disabled')),
	CONSTRAINT "devices_branch_required_ck" CHECK ("devices"."device_type" not in ('pos', 'kiosk', 'display') or "devices"."branch_id" is not null),
	CONSTRAINT "devices_revocation_consistency_ck" CHECK ("devices"."status" <> 'revoked' or "devices"."revoked_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "company_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_memberships_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "company_memberships_company_user_uq" UNIQUE("company_id","user_id"),
	CONSTRAINT "company_memberships_company_id_user_uq" UNIQUE("company_id","id","user_id"),
	CONSTRAINT "company_memberships_status_ck" CHECK ("company_memberships"."status" in ('invited', 'active', 'suspended', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_code_uq" UNIQUE("code"),
	CONSTRAINT "permissions_code_format_ck" CHECK ("permissions"."code" ~ '^[a-z][a-z0-9_]*[.][a-z][a-z0-9_]*$'),
	CONSTRAINT "permissions_description_nonblank_ck" CHECK (length(btrim("permissions"."description")) > 0),
	CONSTRAINT "permissions_domain_nonblank_ck" CHECK (length(btrim("permissions"."domain")) > 0)
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"company_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_pk" PRIMARY KEY("company_id","role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "roles_company_code_uq" UNIQUE("company_id","code"),
	CONSTRAINT "roles_name_nonblank_ck" CHECK (length(btrim("roles"."name")) > 0),
	CONSTRAINT "roles_code_nonblank_ck" CHECK (length(btrim("roles"."code")) > 0),
	CONSTRAINT "roles_status_ck" CHECK ("roles"."status" in ('active', 'inactive', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"branch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_company_id_id_uq" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"password_hash" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_normalized_email_uq" UNIQUE("normalized_email"),
	CONSTRAINT "users_email_nonblank_ck" CHECK (length(btrim("users"."email")) > 0),
	CONSTRAINT "users_normalized_email_ck" CHECK ("users"."normalized_email" = lower(btrim("users"."normalized_email")) and length("users"."normalized_email") > 0),
	CONSTRAINT "users_display_name_nonblank_ck" CHECK (length(btrim("users"."display_name")) > 0),
	CONSTRAINT "users_status_ck" CHECK ("users"."status" in ('pending', 'active', 'suspended', 'disabled')),
	CONSTRAINT "users_password_hash_nonblank_ck" CHECK ("users"."password_hash" is null or length(btrim("users"."password_hash")) >= 20)
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"timezone" text NOT NULL,
	"address" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "branches_company_code_uq" UNIQUE("company_id","code"),
	CONSTRAINT "branches_name_nonblank_ck" CHECK (length(btrim("branches"."name")) > 0),
	CONSTRAINT "branches_code_nonblank_ck" CHECK (length(btrim("branches"."code")) > 0),
	CONSTRAINT "branches_status_ck" CHECK ("branches"."status" in ('active', 'inactive', 'closed')),
	CONSTRAINT "branches_timezone_nonblank_ck" CHECK (length(btrim("branches"."timezone")) > 0),
	CONSTRAINT "branches_address_object_ck" CHECK ("branches"."address" is null or jsonb_typeof("branches"."address") = 'object')
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"timezone" text NOT NULL,
	"currency_code" char(3) NOT NULL,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_uq" UNIQUE("slug"),
	CONSTRAINT "companies_id_scope_uq" UNIQUE("id"),
	CONSTRAINT "companies_legal_name_nonblank_ck" CHECK (length(btrim("companies"."legal_name")) > 0),
	CONSTRAINT "companies_display_name_nonblank_ck" CHECK (length(btrim("companies"."display_name")) > 0),
	CONSTRAINT "companies_slug_format_ck" CHECK ("companies"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "companies_status_ck" CHECK ("companies"."status" in ('active', 'suspended', 'closed')),
	CONSTRAINT "companies_timezone_nonblank_ck" CHECK (length(btrim("companies"."timezone")) > 0),
	CONSTRAINT "companies_currency_code_ck" CHECK ("companies"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "companies_locale_nonblank_ck" CHECK (length(btrim("companies"."locale")) > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "sessions_token_hash_length_ck" CHECK (length(btrim("sessions"."token_hash")) >= 32),
	CONSTRAINT "sessions_status_ck" CHECK ("sessions"."status" in ('active', 'expired', 'revoked')),
	CONSTRAINT "sessions_expiry_ck" CHECK ("sessions"."expires_at" > "sessions"."created_at"),
	CONSTRAINT "sessions_revocation_consistency_ck" CHECK ("sessions"."status" <> 'revoked' or "sessions"."revoked_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_scope_fk" FOREIGN KEY ("company_id","role_id") REFERENCES "public"."roles"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_membership_scope_fk" FOREIGN KEY ("company_id","membership_id") REFERENCES "public"."company_memberships"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_scope_fk" FOREIGN KEY ("company_id","role_id") REFERENCES "public"."roles"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_branch_scope_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_membership_context_fk" FOREIGN KEY ("company_id","membership_id","user_id") REFERENCES "public"."company_memberships"("company_id","id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_scope_fk" FOREIGN KEY ("company_id","device_id") REFERENCES "public"."devices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_company_occurred_idx" ON "audit_log" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_company_branch_occurred_idx" ON "audit_log" USING btree ("company_id","branch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_correlation_idx" ON "audit_log" USING btree ("company_id","correlation_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_company_idx" ON "idempotency_keys" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("available_at","event_id") WHERE "outbox_events"."published_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_events_available_idx" ON "outbox_events" USING btree ("available_at");--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("company_id","aggregate_type","aggregate_id","aggregate_version");--> statement-breakpoint
CREATE INDEX "outbox_events_company_branch_idx" ON "outbox_events" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "devices_company_idx" ON "devices" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "devices_company_branch_idx" ON "devices" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "devices_company_status_idx" ON "devices" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "company_memberships_user_idx" ON "company_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "company_memberships_company_status_idx" ON "company_memberships" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "permissions_domain_idx" ON "permissions" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx" ON "role_permissions" USING btree ("company_id","role_id");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX "roles_company_idx" ON "roles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "roles_company_status_idx" ON "roles" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_company_scope_uq" ON "user_roles" USING btree ("company_id","membership_id","role_id") WHERE "user_roles"."branch_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_branch_scope_uq" ON "user_roles" USING btree ("company_id","membership_id","role_id","branch_id") WHERE "user_roles"."branch_id" is not null;--> statement-breakpoint
CREATE INDEX "user_roles_membership_idx" ON "user_roles" USING btree ("company_id","membership_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("company_id","role_id");--> statement-breakpoint
CREATE INDEX "user_roles_branch_idx" ON "user_roles" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "branches_company_idx" ON "branches" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "branches_company_status_idx" ON "branches" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "companies_status_idx" ON "companies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_company_idx" ON "sessions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "sessions_company_user_idx" ON "sessions" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "sessions_membership_idx" ON "sessions" USING btree ("company_id","membership_id");--> statement-breakpoint
CREATE INDEX "sessions_company_status_idx" ON "sessions" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");