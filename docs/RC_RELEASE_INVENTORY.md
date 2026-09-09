# RC Release Inventory — AS POS V1

**TASK 15.0 Phase 1.** A surface-by-surface audit of every real production
surface in the platform at checkpoint `1035a58` ("fix(parity): complete
forensic legacy closure"), branch `task/12-2`, worktree
`C:\Users\InMagic\Documents\Codex\2026-07-21\asonehq-as-platform\.task-12-2-worktree`.
Read-only, evidence-based, no source file was modified to produce this
document.

## Methodology

For every domain in the master TASK 15.0 spec, this document:

1. Grepped the actual registered routes in `apps/api/src/modules/**/*.routes.ts`
   (never guessed a path) to get the real endpoint list.
2. Traced each route's `requirePermission(...)` call — either inline in the
   route handler, or (for the `admin/*` sub-modules, which delegate to
   `AdministrationService`) in the service method the route calls — against
   the seeded catalog `packages/database/src/seeds/technical-permissions.ts`.
3. Read the Drizzle table definition in `packages/database/src/schema/*.ts`
   backing each surface, confirming `company_id`/`branch_id` columns exist.
4. Grepped the corresponding `*.repository.ts` for a real
   `company_id=$1`-shaped predicate (not assumed from the schema alone).
5. Grepped `apps/one/lib/features/pos/*.dart` for the literal/interpolated
   API path strings a Flutter gateway actually calls, and for the screen/
   widget that reaches it from `pos_navigation.dart`'s `PosModule` enum and
   `pos_shell.dart`'s module switch (`pos_shell.dart:2950-3123`) — the single
   place that decides whether a given `PosModule` renders a real widget or
   falls through to the `_ComingSoon` placeholder (`pos_shell.dart:13817-13863`).
6. Cross-checked restart persistence against `docs/RC_FAILURE_RECOVERY_MATRIX.md`
   (scenarios A/B: real OS process kill+restart, all domains' state
   byte-identical afterward) and `docs/RC_INVENTORY_INVARIANTS.md` (a second,
   independent restart proof for inventory specifically), rather than
   re-running a redundant restart this phase — both were live-tested, not
   assumed, and are cited by file/line below wherever reused.

No route path, permission code, table name, or Flutter file below was
guessed — every one is grep-verified against the file cited next to it.

> **TASK 15.1 update (commercial admin UX closure)**: every Flutter-UI
> gap this document originally found (AUTH's PIN/QR item, TENANT's
> role/user/permission admin item, POS's catalog-admin-depth item, and
> INVENTORY's six-sub-domain item) has since been **closed** by six new,
> real, tested Flutter screens (`PosUserAdministrationScreen`,
> `PosInventoryAdminScreen`, `PosCategoryAdminScreen`,
> `PosBrandAdminScreen`, `PosCatalogAdminScreen`,
> `PosBranchAdminScreen`) plus a real PIN/QR session hand-off — built,
> wired into `pos_navigation.dart`/`pos_shell.dart`, live-tested end to
> end through a real 24-step commercial onboarding walkthrough, and
> live security-probed. See `docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md`
> (Phase 6), `docs/RC_ADMIN_UX_SECURITY.md` (Phase 7), and
> `docs/RC_ADMIN_UX_VERIFICATION.md` (Phase 8) for the complete evidence.
> The verdict paragraphs below are left as originally written (the
> historical record of what TASK 15.0 found), each followed by a
> **TASK 15.1 update** note showing what closed the gap. The one AUTH
> finding that was never a real gap at all (PIN/QR's *verification* UI
> already existed; only the session hand-off was missing) is corrected
> in place, not merely appended to, per that phase's own finding.

---

## AUTH

| Surface | Backend | Database | Flutter | Permission | Tenant isolation | Restart persistence |
|---|---|---|---|---|---|---|
| Login (password) | `POST /api/v1/auth/login` (`auth.routes.ts:166`) | `users`, `company_memberships`, `sessions` (`identity.ts:19,52`, `sessions.ts`) | `pos_auth_gateway.dart` → `AuthGateway.login` (grep-confirmed `auth_gateway.dart` wraps this route); `screens.dart:106` `LoginFoundationScreen` | None required (public entry point by design) | N/A pre-auth | DB-backed session row |
| Browser bootstrap (first device) | `POST /api/v1/auth/browser-bootstrap` (`:199`) | same | `first_run_wizard_screen.dart` | None (bootstrap only) | N/A | DB-backed |
| Refresh / logout / logout-all | `POST /api/v1/auth/refresh` (`:256`), `/logout` (`:298`), `/logout-all` (`:311`) | `sessions`, `session_refresh_tokens` | wired via `auth_gateway.dart` | Session-cookie authenticated only | Session row scoped to its own `user_id`/`company_id` | Real server-side revocation — two real UPDATE statements (`auth.repository.ts:270-280,282-297`, already cited in `docs/RC_SECURITY_CERTIFICATION.md:57`) |
| Company/branch selection & switch | `POST /api/v1/auth/company-selections` (`:342`), `/company-switches` (`:366`), `/branch-switches` (`:393`) | `company_memberships`, `user_branch_access` | `screens.dart:518` `CompanySelectionScreen`, `:548` `BranchSelectionScreen` | Re-derived strictly from the caller's own memberships (`AuthService.switchCompany`, cited in `RC_SECURITY_CERTIFICATION.md:71`), never a client-supplied company id | `resolveContext` joins `user_branch_access`/`company_memberships` fresh every call (`auth.repository.ts:69,109`) | DB-backed |
| Session introspection | `GET /api/v1/auth/session` (`:418`), `/me` (`:436`), `/permissions` (`:442`) | same | used throughout `pos_shell.dart` for `this.context.permissions` gating | Authenticated only | Own session only | DB-backed |
| PIN / QR quick-switch login | `POST /api/v1/auth/pin-login` (`:467`), `/qr-login` (`:489`) | `company_memberships` (PIN/QR hash columns) | Not found wired in any `pos_*_gateway.dart` file (grep for `pin-login`/`qr-login` in `apps/one/lib` returns no matches) | Authenticated via the code itself, not a permission code (by design — it's a login mechanism) | Company scope taken only from the resolved membership, never the request body (`auth.service.ts:606-621`, cited in `RC_SECURITY_CERTIFICATION.md:71`) | DB-backed (argon2id hash columns) |
| Staff PIN/QR issuance (admin side) | `PUT/DELETE /api/v1/auth/staff/:membership_id/pin` (`:514,525`), `/qr` (`:536,552`) | `company_memberships` | Not found wired in Flutter (grep for `staff/.*pin`/`staff/.*qr` in `apps/one/lib` returns no matches) | `staff_credential.manage` (`auth.routes.ts:518,529,540,556`) | Scoped via `requirePermission`+company-membership row lookup | DB-backed |

**AUTH verdict: GREEN for every surface with backend+DB+Flutter presence.**
One real gap: **PIN/QR quick-switch login and staff credential issuance are
real, permissioned, DB-backed backend capabilities with zero Flutter caller**
— a cashier cannot actually use fast PIN/QR switch-user from the real app
today; only the full password login screen is reachable. This is a
backend-only surface, not a broken one (confirmed by grep: no
`pin-login`/`qr-login`/`staff/.../pin`/`staff/.../qr` string anywhere under
`apps/one/lib`).

> **Correction (TASK 15.1)**: the "zero Flutter caller" claim above was
> **stale/incorrect** for the PIN/QR *verification* mechanism — direct
> re-verification found `apps/one/lib/features/pos/pos_auth_gateway.dart`
> (`PosAuthGateway.pinLogin`/`.qrLogin`, real calls to
> `/api/v1/auth/pin-login`/`/qr-login`) and `pos_shell.dart`'s
> `_StaffQuickSwitchDialog` ("Cambiar cajero") already existed and were
> already real and tested — this document's original grep apparently
> searched for the literal route-path strings rather than the gateway
> method/dialog names and missed them. The genuinely real, remaining gap
> was narrower than originally stated: the dialog only *verified* a
> PIN/QR belonged to a real staff member without adopting that session
> as the app's own active one (no real identity hand-off). **This is now
> closed**: `AuthController.quickSwitchByPin`/`quickSwitchByQr`
> (`auth_state.dart`) genuinely replace the active session via the same
> real `_acceptCredentials` path normal login/company-switch/
> branch-switch already use, live-verified with a wrong PIN (real 403),
> a wrong QR (real 401), a deactivated-user probe, and the
> branch-scope/insufficient-permission fallthrough — see
> `docs/RC_ADMIN_UX_VERIFICATION.md` §2. Staff PIN/QR *issuance*
> (`staff_credential.manage`, the admin side of setting a staff member's
> own PIN/QR) remains genuinely without a Flutter screen — a real,
> narrow, non-blocking gap (password login is fully sufficient without
> it), unchanged from the original finding.

---

## TENANT (company / branch model)

| Surface | Backend | Database | Flutter | Permission | Tenant isolation | Restart persistence |
|---|---|---|---|---|---|---|
| Company read/update | `GET/PATCH /api/v1/companies/:company_id` (`companies.routes.ts:15,36`) → `AdministrationService.getCompany/updateCompany` | `companies` (`organizations.ts:6`) | Not a standalone screen; company display name surfaces read-only in app chrome | `company.read`/`company.update` (`admin.service.ts:26,84`) | `actor.context.companyId` threaded through every call (`admin.service.ts:29,87` etc.) | DB-backed |
| Branch list/create/update | `GET/POST /api/v1/companies/:company_id/branches` (`branches.routes.ts:16,41`), `GET/PATCH /api/v1/branches/:branch_id` (`:80,103`) | `branches` (`organizations.ts:34`) | `BranchSelectionScreen` (`screens.dart:548`) reads branches; no create/edit UI found | `branch.read`/`branch.create`/`branch.update` (`admin.service.ts:110,126,194`) | Same pattern | DB-backed |
| Company/branch settings (effective + per-key) | `GET/PUT /api/v1/companies/:company_id/settings/effective` \| `/:key` (`settings.routes.ts:110,138`), same shape for branches (`:195,222`) | `company_settings`, `branch_settings` (`settings.ts:50,79`) | `PosBrandingScreen`/`PosReceiptBrandingScreen` read `effectiveCompanySettings` (`pos_shell.dart:1907`); no generic settings-editor screen | `company_settings.read`/`.update`, `branch_settings.read`/`.update` (`settings.routes.ts:122,163,207,247`) | `company_id` route-param vs. session `companyId` explicit match-check, real 403 `company_scope_mismatch` (already live-verified in `RC_SECURITY_CERTIFICATION.md:70`) | DB-backed, with real optimistic-concurrency (`If-Match`/version conflict, `RC_FAILURE_RECOVERY_MATRIX.md` scenario G) |
| Branding logo upload/delete | `POST/DELETE /api/v1/companies/:company_id/branding/logo` (`branding.routes.ts:177,226`) | logo key stored in `company_settings`; binary in MinIO object storage (per `RC_FAILURE_RECOVERY_MATRIX.md` scenario M) | `PosBrandingScreen` (`pos_branding_screen.dart:71`) | `company_settings.update` (`branding.routes.ts:195,242`) | Explicit `company_id` match-check (`branding.routes.ts:196-201,243-248`, live-tested cross-tenant in `RC_SECURITY_CERTIFICATION.md:73`) | DB-backed metadata; binary survives independently in MinIO (conditional registration — see `RC_FAILURE_RECOVERY_MATRIX.md` scenario M) |
| Devices (register/list/revoke) | `GET/POST /api/v1/devices` (`devices.routes.ts:13,34`), `GET /:device_id` (`:58`), `POST /:device_id/revocations` (`:73`) | `devices` (`devices.ts`) | Not found wired in `apps/one/lib` (grep for `/api/v1/devices` returns zero Flutter matches) | `device.read`/`device.register`/`device.revoke` (`admin.service.ts:826,834,855,897`) | `actor.context.companyId`-scoped | DB-backed |
| Context (companies/branches list for a session) | `GET /api/v1/context/companies` (`context.routes.ts:95`), `/branches` (`:108`) | derived from `company_memberships`/`branches` | Backs `CompanySelectionScreen`/`BranchSelectionScreen` | Authenticated only (read of the caller's own memberships) | Scoped to `context.userId` | DB-backed |
| Users / Roles / Permissions admin | `GET/POST /api/v1/users`, `/:user_id`, `/api/v1/roles`, `/:role_id`, `/:role_id/permissions`, `GET /api/v1/permissions`, `/users/:user_id/roles*`, `/branch-access/*` (`identity.routes.ts:13-311`) | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_branch_access` (`identity.ts`) | `_Users` widget (`pos_shell.dart:2980`, `PosModule.users`) is **read-only** (`allowed: this.context.permissions.contains('user.read')`, `pos_shell.dart:2982`) — role/permission management (`role.create`, `role.permission.manage`, `role.assign`, `user.create`, `user.update`, `branch_access.manage`) has **no Flutter UI at all** (grep for `/api/v1/roles` in `apps/one/lib` returns zero matches) | `user.read/create/update`, `role.read/create/update/permission.manage/assign`, `branch_access.manage`, `permission.read` — all real, all enforced in `admin.service.ts` (lines 226-710 as grepped above) | `actor.context.companyId`-scoped throughout `admin.service.ts`/`admin.repository.ts` | DB-backed |

**TENANT verdict: YELLOW.** Backend/DB/permission layer is fully real and
correctly scoped (independently confirmed live in
`RC_SECURITY_CERTIFICATION.md`'s AUTHORIZATION section: an unprivileged user
was 403'd attempting `PUT /roles/{id}/permissions` and `GET /users`). The
**launch-relevant gap is Flutter, not the backend**: a real park operator
cannot create a user, create/edit a role, assign role permissions, or grant
branch access through the app itself today — `_Users` is view-only and there
is no role/permission screen. Every real environment must be provisioned via
direct API calls (or the `production-owner` CLI bootstrap) rather than the
product UI. This is a genuine administrative-UI gap; see findings summary.

> **Update (TASK 15.1): closed → GREEN.** The read-only `_Users` widget
> was replaced with `PosUserAdministrationScreen` — real Usuarios/Roles/
> Permisos tabs (create/edit/activate-deactivate users, branch/role
> assignment, create/edit roles, a server-authoritative grouped
> permission picker with a client-side self-escalation guard on top of
> the server's own real 403). Branch create/edit was also closed
> (`PosBranchAdminScreen`, new "Sucursales" nav entry) — the
> `Devices`/`generic settings editor` rows below remain real,
> non-blocking, out-of-scope gaps (device management is an infrequent
> security operation, not routine admin; the specific settings that
> matter — branding, receipt text — already have dedicated screens).
> Live-proven end-to-end (real user/role/branch creation, real
> permission assignment, real self-escalation guard) in
> `docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md` and
> `docs/RC_ADMIN_UX_SECURITY.md`.

---

## POS (sales / cart / pricing / discounts / promotions / tax)

| Surface | Backend | Database | Flutter | Permission | Tenant isolation | Restart persistence |
|---|---|---|---|---|---|---|
| Create sale | `POST /api/v1/sales` (`sales.routes.ts:324`) | `sales`, `sale_items` (`sales.ts:63,222`) | `_PosSale` (`pos_shell.dart:2931`, shared by `PosModule.pos`+`PosModule.cafeteria`) via `pos_sales_gateway.dart` | `sale.create`, conditionally `discount.apply`/`reward.redeem` (`sales.routes.ts:393,398,403`) | `sales.repository.ts:529-530` (`company_id=$1` first predicate, cited already in `RC_SECURITY_CERTIFICATION.md:71`) | DB-backed; idempotency via real `idempotency_keys` table (`sales.repository.ts:261-288`), live-proven duplicate-safe (`RC_FAILURE_RECOVERY_MATRIX.md` E/F) |
| List/read/receipt/cancel sale | `GET /api/v1/sales`, `/:id`, `/:id/receipt`, `/:id/discounts`, `POST /:id/cancellations` (`sales.routes.ts:465,534,569,617,649`) | same | `_SalesHistory` (`pos_shell.dart:2985`, `PosModule.history`); receipt via `pos_receipt.dart`/`receipt_print*.dart` | `sale.read`/`sale.cancel` (`:497,545,580,628,667`) | Same repository pattern | DB-backed |
| Pricing quote (checkout preview) | `POST /api/v1/sales/pricing-quotes` (`promotions.routes.ts:516`) | reads `promotions`, `coupons`, `products` live, no dedicated table | `pos_promotions_gateway.dart:650` | `sale.create` (+ conditional `discount.apply`/`reward.redeem`, `:563,565,566`) | Same session-derived `companyId` | Stateless computation, nothing to persist |
| Categories (catalog) | `GET/POST /api/v1/categories`, `PATCH /:id` (`catalog.routes.ts:141,170,231,250`) | `product_categories` (`catalog.ts:24`) | **Read-only**: `pos_read_gateway.dart` calls `GET /api/v1/categories` to populate a filter list; no create/edit screen (`PosModule.categories` is not a case in `pos_shell.dart`'s switch — falls to `_ComingSoon`, `pos_shell.dart:3122`) | `catalog.read`/`category.manage` (`:152,203,242,282`) | `catalog.repository.ts:144,184,217` (`company_id=$1`) | DB-backed |
| Brands | `GET/POST /api/v1/brands`, `PATCH /:id` (`:305,333,379`) | `brands` (`catalog.ts:100`) | **Zero Flutter usage** — grep for `/api/v1/brands` across `apps/one/lib` returns nothing | `catalog.read`/`product.manage` (`:316,357,404`) | `catalog.repository.ts:229,256` | DB-backed |
| Products (list/export/create/update) | `GET/POST /api/v1/products`, `GET /export.csv`, `GET/PATCH /:id` (`product-catalog.routes.ts:364,427,465,536,568`) | `products` (`catalog.ts:172`) | `_Products` (`pos_shell.dart:2958`, `PosModule.products`) is list/read via `controller.products`; `GET /export.csv` (permission `catalog.read`) has **no Flutter caller** (grep confirms zero matches for `products/export`) | `catalog.read`/`product.manage` (`:390,448,477`) | `product-catalog.repository.ts` scoped (same pattern) | DB-backed |
| Product variants + branch prices | `GET/POST /:product_id/variants`, `GET/PATCH /product-variants/:id`, `POST /:product_id/prices` (`:612,649,712,752,777`) | `product_variants`, `product_prices` (`catalog.ts:410,631`) | `PosProductVariantsScreen`/`pos_product_variants_gateway.dart` wires variants CRUD (`pos_shell.dart:2965`); **branch price override (`POST .../prices`) has no Flutter caller** (grep confirms) | `catalog.read`/`product.manage`/`price.manage` (`:552,581,632,662,725`) | Same repository pattern | DB-backed |
| Product options/values + variant barcodes | `product-options.routes.ts` — 8 endpoints (`:194-420`) | `product_option_definitions`, `product_option_values`, `product_variant_option_values`, `product_barcodes` (`catalog.ts:255,327,487,536`) | **Zero Flutter usage** — grep for `product-options`/`product-barcodes` across `apps/one/lib` returns nothing | `catalog.read`/`product.manage` (`:206-432`) | Presumed same pattern (catalog repository shape), not independently re-verified this phase | DB-backed |
| Promotions / coupons admin | `promotions.routes.ts:135-475` (list/create/update for both) | `promotions`, `promotion_branches/products/categories`, `coupons`, `coupon_redemptions` (`promotions.ts:55-352`) | `_PromotionsAdmin` (`pos_shell.dart:3022`, `PosModule.promotions`) via `pos_promotions_gateway.dart:` `/api/v1/promotions`,`/api/v1/coupons` | `promotion.read/manage`, `coupon.read/manage` (`:140,221,241,261,368,414,434,475`) | Session-derived `companyId` (route never accepts one) | DB-backed |
| Held (suspended) sales | `held-sales.routes.ts:103-321`, 7 endpoints | `held_sale_carts` (`held-sales.ts:63`) | `_HeldSales` (`pos_shell.dart:3061`, `PosModule.suspended`) via `pos_held_sales_gateway.dart` | `held_sale.manage` (all 7 routes) | Session-derived `companyId` | DB-backed — **live restart-tested**: `RC_FAILURE_RECOVERY_MATRIX.md` scenario B, real cart survived a real API kill+restart bit-for-bit |

**POS verdict: GREEN** for the core sale/cart/discount/promotion/held-sale
lifecycle — this is the most thoroughly proven domain in the whole
certification (financial invariants, failure recovery, and security all
independently re-confirm it). **YELLOW** on catalog admin depth: brand
management, product CSV export, branch price overrides, and the full
custom-option/barcode system are real, permissioned, DB-backed backend
capabilities with **no Flutter caller at all** — a park can be run day-to-day
(sell, discount, promote, suspend/resume) but a subset of catalog setup work
must happen outside the app.

> **Update (TASK 15.1): closed → GREEN.** `PosCategoryAdminScreen`
> (categories — previously had **no screen at all**, not even
> read-only), `PosBrandAdminScreen` (brands), and
> `PosCatalogAdminScreen` (branch price overrides, custom
> options/variant barcodes, CSV export) close every item in this
> finding. A far more significant, previously-undetected gap was found
> and fixed live during the same pass: **base-product creation itself
> had zero Flutter caller** (`POST /api/v1/products` was never reached
> by any gateway — `pos_product_variants_gateway.dart`'s `createVariant`
> only adds a variant to an already-existing product) — a real
> commercial launch blocker, since a park owner could not create a
> single new product through the app. Fixed, plus three cascading bugs
> the fix's own live testing surfaced (wrong default unit code; new
> products silently not stock-tracked; new products permanently
> unsellable, `status` defaulting to `draft` with no activation path
> anywhere in the app) — all four fixed and proven end-to-end with a
> real create→price→restock→sell pipeline completing a real sale. See
> `docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md` steps 12-16.

---

## CASH (registers / sessions / movements / closures)

| Surface | Backend | Database | Flutter | Permission | Tenant isolation | Restart persistence |
|---|---|---|---|---|---|---|
| Register create/list/read/device-assign | `cash.routes.ts:121-250` | `cash_registers` (`cash.ts:54`) | `_Caja` (`pos_shell.dart:2999`, `PosModule.cash`, keyed per-branch — `ValueKey('caja-${branchId}')`) via `pos_cash_gateway.dart` (`/api/v1/cash-registers`) | `cash_register.manage`/`.read` (`:144,189,219,250`) | `cash.repository.ts:384,397,430,447` (`company_id=$1`) | DB-backed |
| Session open/read/current/close | `:268-652` | `cash_sessions` (`cash.ts:128`) | Same `_Caja` widget, `pos_cash_gateway.dart` `/api/v1/cash-sessions*` | `cash_session.open/.read/.close` (`:290,328,372,405,428,595`) | Same repository pattern | DB-backed; **live restart-tested as part of the full Phase 4 walkthrough** (`RC_FAILURE_RECOVERY_MATRIX.md` scenario A: closed register/session state read back identical after a real process restart) |
| Movements (in/out) | `:465-558` | `cash_movements` (`cash.ts:227`) | Same gateway | `cash_movement.create` (`:494,638`) | Same pattern | DB-backed |
| Partial close | `:625-663` | `cash_session_partial_closes` (`cash.ts:366`) | Same gateway | `cash_session.close`/`cash_movement.create`/`cash_session.read` (`:595,638,663`) | Same pattern | DB-backed |
| Cash-session-gated cash payment | `POST /api/v1/sales/:sale_id/cash-payments` (`payments.routes.ts:493`) | `payments` referencing the open `cash_sessions` row | wired via `pos_payments_gateway.dart` | `payment.create` (`:519`) | Same pattern | Live-tested fail-closed: attempting a cash payment against a closed register returns real `409 cash_session_required` (`RC_FAILURE_RECOVERY_MATRIX.md` scenario K) |

**CASH verdict: GREEN.** Every register/session/movement/closure surface
that exists on the backend has a real, permission-gated, tenant-scoped,
DB-backed, restart-proven Flutter counterpart in `_Caja`. No gap found.

---

## PAYMENTS & REFUNDS

| Surface | Backend | Database | Flutter | Permission | Tenant isolation | Restart persistence |
|---|---|---|---|---|---|---|
| Terminals (register/list/read) | `payments.routes.ts:221-323` | `payment_terminals` (`payments.ts:68`) | `pos_payments_gateway.dart` `/api/v1/payment-terminals` | `device.register`/`.read` (`:245,292,323`) | Session-derived | DB-backed |
| Card/generic payment create/read/list | `:335-641` | `payments`, `payment_attempts` (`payments.ts:116,224`) | `pos_payments_gateway.dart` | `payment.create`/`.read` (`:364,604,641`) | Session-derived | DB-backed |
| Cash-payment / zero-total completion | `:493,566` | same | `pos_payments_gateway.dart` `sales/$saleId/cash-payments` | `payment.create` (`:519`) | Session-derived | DB-backed |
| Reward-funded payment | reward-redemption branch of payment create | `payments` + `reward_entitlements` | `pos_payments_gateway.dart` | `reward.redeem` (`:581`) | Session-derived | DB-backed |
| Payment attempts / transitions / cancel / reverse | `:662-801` | `payment_attempts` | `pos_payments_gateway.dart` | `payment.create`/`.reverse` (`:674,724,767,801`) | Session-derived | DB-backed |
| Mercado Pago webhook | `mercado-pago.webhook.routes.ts:69` (`POST /api/v1/webhooks/mercado-pago`) | writes into `payment_attempts` via `PaymentService` | N/A — server-to-server webhook, not a UI surface | HMAC signature verification (`verifyMercadoPagoSignature`, `:88`), not a user permission — correct for a webhook | `PaymentRepository.findAttemptCompanyByProviderReference` deliberately never trusts `provider_reference` alone (per the file's own doc comment, `:50-54`) | DB-backed |
| Refund balance / create / read / complete | `refunds.routes.ts:87-288` | `refunds`, `refund_items` (`refunds.ts:60,190`) | `_Devoluciones` (`pos_shell.dart:3009`, `PosModule.returns`) via `pos_refunds_gateway.dart` `/api/v1/refunds` | `refund.read`/`.create`/`.complete` (`:98,167,202,250,288`) | Session-derived | DB-backed; **restart+concurrency proven**: `RC_INVENTORY_INVARIANTS.md` §4 (exact-quantity refund restock, before/after balance proof), `RC_FAILURE_RECOVERY_MATRIX.md` scenario S (double-completion rejected `409`) |

**PAYMENTS & REFUNDS verdict: GREEN**, with the Mercado Pago provider
correctly reported per the freeze policy as **EXTERNAL PROVIDER ACTIVATION
PENDING** — the webhook code itself is real (signature verification, raw-body
HMAC, company-scoped lookup), but no credentials are configured and no live
call has been made, deliberately, for the entire certification. This is not
a red/broken item; it is a pre-launch activation step, exactly as the RC
freeze policy classifies it.

**Correction to an earlier draft of this finding** (verified directly
against the service source, not just a route-file grep, before this
document was finalized): `refund.approve` **is** genuinely wired and
live-enforced — just not at the route-guard layer the rest of this table
samples. `refunds.service.ts:235-238` checks
`context.actorPermissions.includes('refund.approve')` inline and throws
the real `refund_approval_required` error otherwise; this is exactly the
behavior independently, live-confirmed in `RC_FINANCIAL_INVARIANTS.md`
§4 (a cashier's own refund attempt was rejected with a real
403/`refund_approval_required`, retried successfully as a manager) and
covered by an integration test
(`refunds.integration.test.ts:408-420`, "an actor without
`refund.approve` is rejected outright"). `refund.cancel` is the only
code of the two that is genuinely unused — confirmed via
`bootstrap-owner.service.ts:137`'s own comment ("Deliberately NOT added:
`refund.cancel` — no cancellation endpoint") and no other reference
anywhere outside test fixtures. Not a security gap either way (nothing
is under-permissioned); `refund.cancel` alone is the minor
catalog-hygiene note (a reserved-but-unused code, worth a future
decision to wire or remove, outside this freeze's scope).

---

## INVENTORY (products / variants / balances / movements / transfers / counts / direct purchases)

| Surface | Backend | Database | Flutter | Permission | Tenant isolation | Restart persistence |
|---|---|---|---|---|---|---|
| Locations (create/list/manage) | `inventory.routes.ts:203-338` | `inventory_locations` (`inventory.ts:129`) | Not independently surfaced as its own screen; balances view implies default location | `inventory.read`/`inventory_location.manage` (`:224,277,338`) | `inventory.repository.ts:53,105,140-201` (`companyId` threaded throughout, cited above) | DB-backed |
| Balances | `GET /api/v1/inventory/balances` (`:367`) | `inventory_balances` (`inventory.ts:409`) | `_Inventory` (`pos_shell.dart:2969`, `PosModule.inventory`) via `controller.loadBalances` | `inventory.read` (`:388`) | Same pattern | DB-backed; **independently restart-tested twice** (`RC_INVENTORY_INVARIANTS.md` §6: `420.000000` identical before/after a real OS kill+restart) |
| Movements (read) | `GET /api/v1/inventory/movements` (`:421`) | `inventory_movements` (`inventory.ts:223`) | Not surfaced as its own ledger/history screen in Flutter (grep for `inventory/movements` in `apps/one/lib` returns zero matches) | `inventory.read` (`:447`) | Same pattern | DB-backed |
| Movement drafts (manual adjustments, create/edit/submit/post/cancel) | `inventory-drafts.routes.ts:201-490` + `inventory-posting.routes.ts:102,153` (10 endpoints total) | Same `inventory_movements`/`inventory_movement_lines` tables (`inventory.ts:223,501`) | **Zero Flutter usage** — grep for `inventory/movements` (POST/PATCH forms), "ajuste de inventario" and equivalents returns nothing anywhere in `apps/one/lib` | `inventory.adjust`/`.approve`/`.read` (`inventory-drafts.routes.ts:222-490`, `inventory-posting.routes.ts:137,197`) | Presumed same repository pattern; not independently re-verified this phase | DB-backed |
| Reservations (create/confirm/release) | `reservation.routes.ts:133-343` | `inventory_reservations`, `inventory_reservation_lines` (`inventory.ts:888,1000`) | **Zero Flutter usage** (grep confirms) | `inventory.read`/`inventory.reservation.manage` (`:163,238,281,319`) | Presumed same pattern | DB-backed |
| Counts (create/lines/submit/approve/apply/cancel) | `inventory-counts.routes.ts:140-379` | `inventory_counts`, `inventory_count_lines` (`inventory.ts:1093,1257`) | **Zero Flutter usage** (grep confirms) | `inventory.read`/`inventory.count` (`:166,230,268,304,345,400`) | Presumed same pattern | DB-backed |
| Reconciliation findings/repairs | `inventory-reconciliation.routes.ts:194-404` | `inventory_reconciliation_findings` (`inventory.ts:1349`) | **Zero Flutter usage** (grep confirms) | `inventory.reconcile`/`.approve` (`:227,294,326,371,434,435`) | Presumed same pattern | DB-backed |
| Movement reversal | `inventory-reversal.routes.ts:76` | Same movements table (reversal is a linked movement) | **Zero Flutter usage** (grep confirms) | `inventory.reverse` (`:151`) | Presumed same pattern | DB-backed |
| Branch-to-branch transfers | `inventory-transfers.routes.ts:162-384` | `inventory_transfers`, `inventory_transfer_lines` (`inventory.ts:597,811`) | **Zero Flutter usage** (grep confirms) | `inventory.read`/`inventory.transfer`/(receive via `permission` var, `:329`) `inventory.receive` (`:188,262,289,329`) | Presumed same pattern; confirmed atomic and real by direct code inspection per `RC_INVENTORY_INVARIANTS.md` §7 | DB-backed |
| Direct purchases (quick restock) | `purchasing.routes.ts:98-208` | `direct_purchases` (`purchasing.ts:28`) | `_DirectPurchases` (`pos_shell.dart:3072`, `PosModule.purchases`) via `pos_purchasing_gateway.dart` `/api/v1/direct-purchases` | `purchase.create`/`.read` (`:126,166,208`) | `purchasing.repository.ts:256,297,325` (`company_id=$1`) | DB-backed; **fully live-proven**: `RC_INVENTORY_INVARIANTS.md` §1/§3 — atomic purchase+ledger-posting in one transaction, restart-identical |
| Suppliers | `suppliers.routes.ts:104-241` | `suppliers` (`suppliers.ts:19`) | `PosSuppliersScreen` (`pos_shell.dart:3081`, `PosModule.suppliers`) via `pos_suppliers_gateway.dart`/`pos_suppliers_screen.dart` | `supplier.read`/`.manage` (`:116,154,180,209,241`) | `suppliers.repository.ts:292` (`company_id=$1`) | DB-backed |

**INVENTORY verdict: YELLOW — the widest backend/Flutter gap found in this
audit.** The core sell-through loop (balances, direct-purchase restock,
suppliers) is GREEN and independently proven live (financial + inventory
invariants + restart, all in `RC_INVENTORY_INVARIANTS.md`). But **six real,
schema-backed, permission-gated backend capabilities have zero Flutter UI**:
manual movement drafts/adjustments, inventory reservations, physical counts,
reconciliation findings/repairs, movement reversal, and branch-to-branch
transfers. `RC_INVENTORY_INVARIANTS.md` §7 already flags transfers
specifically as untested this rehearsal because of a permission-catalog gap
(now fixed — `inventory.transfer`/`inventory.receive` are present in
`technical-permissions.ts:77-78`); this document additionally establishes
that **even with the permission fixed, there is still no Flutter screen to
reach transfers, counts, reconciliation, reservations, or manual adjustments
from the real app** — those six capabilities are only reachable by calling
the API directly. A park cannot run a physical inventory count, adjust stock
for breakage/loss, or move stock between branches through the product today.

> **Update (TASK 15.1): closed → GREEN.** `PosInventoryAdminScreen` adds
> six real tabs (Movimientos, Traspasos, Conteos, Reservas,
> Ajustes/Reconciliación — movement reversal folded in as an in-tab
> action rather than a 7th tab — and Ubicaciones), covering every
> sub-domain above plus locations (also previously screen-less). Every
> mutation requires a real reason/approval step matching the backend's
> own real state machine; no control anywhere lets an operator set a
> stock number directly — server-authoritative, ledger-backed
> throughout. A real Flutter-infra bug was found and fixed along the
> way: `inventory-posting.routes.ts`'s `submit`/`post` endpoints reject
> ANY defined request body (even `{}`), but `ApiClient.postJson` always
> sent one — added an `omitBody` parameter (opt-in, zero behavior change
> for ~15 pre-existing call sites) so these two real, already-shipped
> endpoints became callable at all. Live-proven end-to-end in
> `docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md` step 9 (location
> creation) and step 16 (restock).

---

## CUSTOMERS (loyalty / rewards / customer records / memberships)

| Surface | Backend | Database | Flutter | Permission | Tenant isolation | Restart persistence |
|---|---|---|---|---|---|---|
| Customer CRUD + QR tokens | `customers.routes.ts:116-329` | `customers`, `customer_qr_tokens` (`customers.ts:74,155`) | `_CustomersAdmin` (`pos_shell.dart:3030`, `PosModule.customers`) via `pos_customers_gateway.dart` — full endpoint parity confirmed (`/api/v1/customers`, `/qr-tokens`, `/qr-tokens/active`, `qr-tokens/resolve`) | `customer.create/.read/.update` (`:128,182,216,239,282,303,329`) | `customers.repository.ts:278,292,367,389` (`company_id=$1`) | DB-backed; SQL-injection-shaped input independently probed live and confirmed stored as inert data (`RC_SECURITY_CERTIFICATION.md:87`) |
| Loyalty programs + accounts + adjust | `loyalty.routes.ts:116-289` | `loyalty_programs`, `loyalty_accounts`, `loyalty_ledger` (`customers.ts:384,569,602`) | `pos_customers_gateway`/`pos_loyalty_gateway.dart` — full endpoint parity (`/api/v1/loyalty-programs`, `/customers/:id/loyalty`, `/loyalty/adjust`) surfaced inside Customer Detail | `loyalty.read/.manage/.adjust` (`:121,184,204,258,289`) | Same pattern (module shares `customers.ts` schema file) | DB-backed |
| Reward entitlements (issue/redeem/revoke/token) | `rewards.routes.ts:77-221` | `reward_entitlements`, `reward_entitlement_tokens` (`customers.ts:707,829`) | `pos_rewards_gateway.dart` — full endpoint parity | `reward.read/.issue/.redeem/.revoke` (`:82,115,137,158,185`) | Same pattern | DB-backed; concurrency-proven: a second redemption of an already-redeemed entitlement is rejected `409` via a real CAS-updated status column, not a racy counter (`RC_FAILURE_RECOVERY_MATRIX.md` scenario R) |
| Membership plans + issued memberships | `memberships.routes.ts:100-329` | `membership_plans`, `membership_plan_branches`, `customer_memberships` (`customers.ts:195,242,283`) | `_MembershipsAdmin` (`pos_shell.dart:3042`, `PosModule.memberships`) + Customer Detail; `pos_memberships_gateway.dart` full endpoint parity | `membership.read/.manage/.issue` (`:105,150,165,185,219,247,275,300,329`) | Same pattern | DB-backed |

**CUSTOMERS verdict: GREEN.** This is the one CRM-shaped domain with total
backend/DB/Flutter/permission/tenant-isolation parity — every route grepped
in the four routes files has a confirmed Flutter caller. No gap found.

---

## FIESTAS (party rooms / packages / reservations / payments)

| Surface | Backend | Database | Flutter | Permission | Tenant isolation | Restart persistence |
|---|---|---|---|---|---|---|
| Rooms | `party-rooms.routes.ts:71-190` | `party_rooms` (`parties.ts:70`) | `pos_parties_gateway.dart:41,44,52,55,185,205,212,219` — full CRUD wired | `party.read`/`.manage` (`:98,145,173,214`) | `parties.repository.ts:516,534,548` (`company_id=$1`, plus `branch_id=any($2)`) | DB-backed |
| Packages + quote | `party-packages.routes.ts:86-273` | `party_packages` (`parties.ts:133`) | `pos_parties_gateway.dart` — full endpoint parity (`/api/v1/party-packages`, `.../quote`) | `party.read`/`.manage` (`:120,175,203,258,293`) | Same pattern | DB-backed |
| Reservations (create/list/calendar/update/status/cancel) | `party-reservations.routes.ts:159-680` | `party_reservations` (`parties.ts:221`) — real GIST-exclusion constraint (`party_reservations_room_time_excl`) preventing double-booking at the DB layer | `_FiestasAdmin` (`pos_shell.dart:3051`, `PosModule.events`) via `pos_parties_gateway.dart` — full endpoint parity including `/calendar` | `party.read`/`.manage`/`.cancel` (`:192,260,297,334,391,424,461`) | Same pattern | DB-backed; **race-condition proven at the DB layer, not app-only**: two overlapping reservations for the same room/date — the second genuinely rejected `409 party_conflict` (`RC_FAILURE_RECOVERY_MATRIX.md` scenario Q, migration-confirmed) |
| Snacks / socks add-ons + deduction | `:490-609` | `party_reservation_snacks`, `party_reservation_socks` (`parties.ts:366,397`) | `pos_parties_gateway.dart` full parity | `party.manage`/`.read` (`:512,530,560,577,595`) | Same pattern | DB-backed |
| Payments + balance | `:609-665` | `party_reservation_payments` (`parties.ts:447`) | `pos_parties_gateway.dart` full parity | `party.payment.record`/`.read` (`:631,651`) | Same pattern | DB-backed |
| Documents (contract/receipt) | `:665-680` | `party_reservation_documents` (`parties.ts:497`) | `pos_parties_gateway.dart` full parity | `party.read` (`:680`) | Same pattern | DB-backed |

**FIESTAS verdict: GREEN.** Every backend route across all three
`parties/*.routes.ts` files has a confirmed Flutter caller in
`pos_parties_gateway.dart`, and the reservation domain's core correctness
property (no double-booking) is enforced by a real Postgres constraint, not
an app-level check a race could slip past. No gap found. Mirrors the legacy
recovery work documented in `docs/LEGACY_FIESTAS_RECOVERY.md`.

---

## PEOPLE (employees / schedules / time-clock / payroll)

| Surface | Backend | Database | Flutter | Permission | Tenant isolation | Restart persistence |
|---|---|---|---|---|---|---|
| Employees (CRUD, deactivate/reactivate) | `employees.routes.ts:87-306` | `employees` (`people.ts:39`) | `PosPeopleScreen` (`pos_shell.dart:3103`, `PosModule.employees`) via `pos_people_gateway.dart` — full endpoint parity | `employee.read`/`.manage` (`:117,158,187,251,293,318`) | `people.repository.ts:392,403,463,476,534,574,578` (`company_id=$1`, plus `branch_id=any($2)`) | DB-backed |
| Schedules | `schedules.routes.ts:76-123` | `employee_schedules` (`people.ts:123`) | `pos_people_gateway.dart` full parity | `schedule.manage`/`.read` (`:101,143`) | Same pattern | DB-backed |
| Time clock (in/out/corrections/punches) | `time-clock.routes.ts:62-184` | `time_clock_punches` (`people.ts:178`) | `pos_people_gateway.dart` full parity | `attendance.read`/`.manage` (`:82,116,163,205`) | Same pattern | DB-backed |
| Payroll periods (create/calculate/close/reopen) | `payroll.routes.ts:84-219` | `payroll_periods`, `payroll_period_lines` (`people.ts:231,281`) | `pos_people_gateway.dart` full parity | `payroll.read`/`.manage`/`.close` (`:105,130,156,181,206,231`) | Same pattern | DB-backed; **live-tested tier separation**: an actor with only `payroll.manage` is 403'd on `POST /payroll-periods/{id}/close`, which requires the separate `payroll.close` (`payroll.integration.test.ts:383-406`, executed live per `RC_SECURITY_CERTIFICATION.md:75`); company A gets a row-hiding `404` (not `403`) on company B's payroll period (`payroll.integration.test.ts:408-427`) |

**PEOPLE verdict: GREEN.** Full parity across employees, schedules,
time-clock, and payroll, with cross-tenant and privilege-tier isolation
independently live-tested (not merely read from code) in the Phase 8
security certification. No gap found.

---

## ACCESS (credentials / scan / occupancy)

| Surface | Backend | Database | Flutter | Permission | Tenant isolation | Restart persistence |
|---|---|---|---|---|---|---|
| Credential issue/list/read/void/unvoid/lookup-by-code | `access.routes.ts:111-373` | `access_credentials` (`access.ts:60`) | `PosAccessScreen` (`pos_shell.dart:3096`, `PosModule.access`) via `pos_access_gateway.dart` — full endpoint parity | `access.scan`/`.read`/`.manage` (`:135,179,216,249,279,301,331,365`) | `access.repository.ts:298,314,338,357` (`company_id=$1`) | DB-backed |
| Scan (entry) | `POST /api/v1/access-credentials/scan` (`:160`) | writes `access_events` (`access.ts:146`) | Same gateway | `access.scan` (`:179`) | Same pattern | DB-backed; **honest-failure live-proven**: an unissued code returns real `404 credential_not_found` (`RC_FAILURE_RECOVERY_MATRIX.md` scenario O); a voided credential returns real `409 credential_void` (scenario P) — never a fabricated success, unlike the legacy's own fake scanner (explicitly not reproduced, per `docs/LEGACY_FUNCTIONAL_PARITY.md`) |
| Occupancy | `GET /api/v1/access-credentials/occupancy` (`:200`) | Server-side aggregate over `access_events` | Same gateway | `access.read` (`:216`) | Same pattern | DB-backed (server-computed count, not a client-tracked counter) |
| Access events (history) | `GET /api/v1/access-events` (`:373`) | `access_events` (`access.ts:146`) | Same gateway | `access.read` (`:395`) | Same pattern | DB-backed |

**ACCESS verdict: GREEN.** Full parity, and this domain deliberately and
verifiably replaces the legacy's own fake ticket scanner with real,
fail-closed, server-computed occupancy. No gap found.

---

## MANAGEMENT (roles / permissions / users / settings / branding / reports / dashboard)

| Surface | Backend | Database | Flutter | Permission | Tenant isolation | Restart persistence |
|---|---|---|---|---|---|---|
| Roles/permissions/users/branch-access | *(see TENANT section above — same routes, not duplicated)* | | **No Flutter UI** (see TENANT finding) | | | |
| Company/branch settings + branding | *(see TENANT section above)* | | Branding: real screen. Generic settings key/value editor: no screen (`PosModule.settings` falls to `_ComingSoon`, `pos_shell.dart:3122`); `settingsGateway`'s `effectiveCompanySettings` IS consumed by `PosBrandingScreen`/`PosReceiptBrandingScreen`, so settings data is reachable indirectly, just not as a general admin screen | | | |
| Receipt branding | `settings.routes.ts` (reuses company/branch settings keys) | `company_settings`/`branch_settings` | `PosReceiptBrandingScreen` (`pos_shell.dart:3112`, `PosModule.receiptBranding`) | `company_settings.update` | Same as settings | DB-backed |
| Dashboard | `GET /api/v1/dashboard/summary` (`dashboard.routes.ts:121`) | Server-aggregated over `sales`/`cash_sessions`/`inventory_balances`/`party_reservations` — no dedicated table | `_Dashboard` (`pos_shell.dart:2954`, `PosModule.dashboard`) via `pos_dashboard_gateway.dart:` `/api/v1/dashboard/summary` | `report.read` (`:126`) | Session-derived `companyId`/`permittedBranchIds` | Nothing to persist (aggregation is real-time) |
| Reports (sales/financial/inventory/promotions/customers/employees/parties/access + 2 CSV exports) | `reports.routes.ts:226-424` — 11 registered routes | Aggregated over the respective domain tables | `PosReportsScreen` (`pos_shell.dart:3088`, `PosModule.reports`) via `pos_reports_gateway.dart` — **all 11 routes independently confirmed wired** (`/reports/sales`, `/financial`, `/inventory`, `/promotions`, `/customers`, `/employees`, `/parties`, `/access`, plus `/sales/export.csv`, `/financial/export.csv`, `/inventory/kardex.csv`) | `report.read` (all 11 routes) | Session-derived, each report further filtered by the caller's own `permittedBranchIds` (per the file's own doc comment on `report.read`'s coarseness, `technical-permissions.ts:192-197`) | Aggregation is real-time |
| Assistant (deterministic FAQ bot) | `POST /api/v1/assistant/query` (`assistant.routes.ts:68`) | Reads live data across dashboard/reports/cash/inventory/parties — no dedicated table | `PosAssistantScreen` (`pos_shell.dart:3118`, `PosModule.assistant`) via `pos_assistant_gateway.dart:` `/api/v1/assistant/query` | **Deliberately authentication-only, no permission code** — documented design decision (`assistant.routes.ts:10-35`): it invents no new capability, only re-exposes data the caller's own session already has standing access to via other permission-gated endpoints | `requireBranchAccess` still enforced when `branch_id` is supplied (`:73`) — cannot widen scope | Nothing to persist |
| CFDI / Facturación | `PosModule.billing` exists in the nav enum (`pos_navigation.dart:26`) | **No backend module exists** — `apps/api/src/modules` has no `billing`/`invoicing`/`cfdi` directory (confirmed by listing all 22 top-level modules) | Falls to `_ComingSoon` (`pos_shell.dart:3122`), explicitly labeled "Coming soon" in the running app | N/A — no route exists to gate | N/A | N/A — no backend state exists |
| Documents / Sync / Notifications | `PosModule.documents/sync/notifications` in nav enum (`:33-35`) | No backend module for any of the three | `_ComingSoon` for all three | N/A | N/A | N/A |

**MANAGEMENT verdict: YELLOW.** Reports, Dashboard, Assistant, and receipt
branding are GREEN with full parity. The real gaps: (1) role/permission/user
administration has zero Flutter UI (same finding as TENANT, not duplicated
as a second blocker); (2) a general settings key/value editor doesn't exist
as a screen, though the specific settings that matter for launch (branding,
receipt text) are each reachable through their own dedicated screen; (3)
CFDI/Facturación, Documentos, Sincronización, and Notificaciones are
navigation-only placeholders with **no backend module at all** — these were
never built, on either side, and the running app is honest about that
("Coming soon"), which is a legitimate placeholder pattern, not a hidden gap.

> **Update (TASK 15.1): GREEN.** Finding (1) closed — see the TENANT
> section's own update note above (not duplicated here). Finding (2)
> remains, unchanged, a real but non-blocking gap (a generic settings
> editor was never in this task's scope — the specific launch-critical
> settings already have dedicated screens). Finding (3) is explicitly
> out of scope per this task's own "Do NOT expand into new product
> domains" instruction and remains honestly labeled "Coming soon" — not
> a regression, never built on either side.

---

## Findings summary — what's NOT production-ready

**TASK 15.1 update**: findings 1-4 below (the only four with a real
Flutter-UI gap) are **CLOSED** — see each finding's own strikethrough
note and the update notes in the domain sections above. Findings 5-7
were never UI gaps (placeholders, an external-provider activation step,
and a cosmetic catalog-hygiene note respectively) and remain unchanged,
correctly out of scope.

| # | Finding | Domain | Backend? | DB? | Flutter? | Permission? | Tenant-scoped? | Severity |
|---|---|---|---|---|---|---|---|---|
| 1 | ~~Role/permission/user administration (create user, create/edit role, assign role permissions, grant branch access) has no Flutter UI~~ **CLOSED (TASK 15.1)**: `PosUserAdministrationScreen`, live-proven | TENANT / MANAGEMENT | Yes, real & tested | Yes | **Yes** | Yes, real (`role.*`, `user.*`, `branch_access.manage`) | Yes | **Closed** |
| 2 | ~~Six inventory sub-domains — manual adjustment drafts, reservations, physical counts, reconciliation, movement reversal, branch transfers — zero Flutter UI~~ **CLOSED (TASK 15.1)**: `PosInventoryAdminScreen`, 6 tabs + locations, live-proven | INVENTORY | Yes, real & restart/atomicity-tested | Yes | **Yes** | Yes, real (all codes present in the seed catalog) | Same pattern, confirmed | **Closed** |
| 3 | ~~Catalog admin depth: brand CRUD, product CSV export, branch price overrides, and the full custom-option/barcode system have no Flutter UI~~ **CLOSED (TASK 15.1)**: `PosCategoryAdminScreen`/`PosBrandAdminScreen`/`PosCatalogAdminScreen`, live-proven — **plus a far more severe gap found and fixed in the same pass: base-product creation itself had zero Flutter caller at all** (see POS section update) | POS / Catalog | Yes | Yes | **Yes** | Yes | Same pattern | **Closed** |
| 4 | ~~PIN/QR quick-switch staff login... no Flutter caller~~ **Corrected + closed (TASK 15.1)**: the verification UI already existed (a stale finding, corrected in place in the AUTH section above); the real gap — session hand-off — is now closed (`AuthController.quickSwitchByPin`/`quickSwitchByQr`), live-proven. Staff PIN/QR *issuance* admin screen remains a real, narrow, non-blocking gap (password login is sufficient) | AUTH | Yes | Yes | **Yes** (hand-off); No (issuance, unchanged) | Yes (`staff_credential.manage`) | Yes | **Closed** (hand-off); issuance remains **acceptable gap** |
| 5 | CFDI/Facturación, Documentos, Sincronización, Notificaciones are navigation placeholders with no backend module at all | MANAGEMENT | **No** | **No** | Placeholder only, honestly labeled | N/A | N/A | **Not a regression** — never built on either side; explicitly out of this certification's scope per `docs/RC_FREEZE_POLICY.md` ("Speculative new modules... not allowed during the freeze") and TASK 15.1's own "Do NOT expand into new product domains" |
| 6 | Mercado Pago (card/terminal payment provider) | CASH/PAYMENTS | Yes, real webhook/signature code | Yes | Gateway support exists in `pos_payments_gateway.dart` for the generic payment surface | Yes | Yes | **EXTERNAL PROVIDER ACTIVATION PENDING** — per the RC freeze policy, this is explicitly not counted as RED; no credentials configured, no live call made, by design, for the entire certification |
| 7 | `refund.cancel` permission code exists in the seed catalog but no route/service path currently requires it (**correction**: `refund.approve`, originally also flagged here, is confirmed genuinely wired — enforced inline in `refunds.service.ts:235-238`, live-verified in `RC_FINANCIAL_INVARIANTS.md` §4 and covered by `refunds.integration.test.ts:408-420`) | CASH/PAYMENTS | N/A (catalog hygiene) | N/A | N/A | Catalog contains one unused code | N/A | **Cosmetic** — not a security gap (nothing is under-permissioned), one seeded code (`refund.cancel`) with no current consumer (`bootstrap-owner.service.ts:137` documents this as deliberate — no cancellation endpoint exists); worth a follow-up decision (wire it into a future cancel workflow, or remove it) outside this freeze |

---

## Overall verdict

**As of TASK 15.0 (superseded below by TASK 15.1)**: GREEN for the domains
that carry the actual business of running a park on launch day, YELLOW
for three genuine but non-blocking UI-coverage gaps, zero RED.

## TASK 15.1 update — overall verdict now GREEN

Every one of TASK 15.0's three YELLOW UI-coverage gaps (tenant/user/role
administration, six inventory sub-domains, catalog admin depth +
PIN/QR hand-off) is now **closed** by six new, real, tested Flutter
screens plus a real session hand-off — built, wired, live-walked-through
end to end as a real park owner would use them (a real disposable
"AS Commercial Demo Park" tenant, 24-step onboarding, zero SQL/Postman/
curl/source-edits beyond the one allowed CLI bootstrap step), and live
security-probed (cashier/manager/tenant/branch/dead-session boundaries,
all real HTTP evidence, zero gaps found). See
`docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md`,
`docs/RC_ADMIN_UX_SECURITY.md`, and `docs/RC_ADMIN_UX_VERIFICATION.md`
for the complete evidence trail.

This pass additionally found and fixed **9 real, launch-blocking bugs**
that TASK 15.0's own static/live audit had not surfaced (because they
only manifest when an operator actually tries to USE the previously
missing screens) — most severely, **base-product creation had zero
Flutter caller at all**, and the three related bugs its own fix
surfaced (wrong default unit, silently-untracked inventory, permanently
unsellable `draft`-status products with no activation path anywhere in
the app) would have made even a fixed create-product flow non-functional
for a real launch. Every one of the 9 was fixed narrowly and re-verified
live, end to end, including a real completed POS sale proving the full
create→price→restock→sell pipeline. See the domain sections above and
`docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md` §3 for the full list.

**Remaining YELLOW-level findings, all genuinely non-blocking**: (1) a
generic company/branch settings key/value editor doesn't exist as a
screen (the specific settings that matter for launch — branding,
receipt text — each have their own dedicated screen); (2) staff PIN/QR
*issuance* (setting another employee's own PIN/QR, as opposed to using
one to quick-switch) has no Flutter screen — password login remains
fully sufficient; (3) device registration/revocation management has no
Flutter screen (an infrequent security operation, not routine admin).
None of these were in this task's own explicit scope
(`role/user/permission`, `six inventory sub-domains`,
`catalog admin depth`, `PIN/QR fast-switch`) and none block a
commercial launch.

**No RED items were found in this phase, or introduced by TASK 15.1's
own changes.** No route was found unpermissioned, no repository query
was found missing `company_id` scoping among those sampled (including
the six new admin screens' own endpoints, live cross-tenant-probed in
`docs/RC_ADMIN_UX_SECURITY.md`), and no state was found to be
dangerously in-memory — every mutable domain surface inventoried here is
backed by a real Postgres table, and the restart-persistence claims made
throughout this document are grounded in real, cited, already-executed
OS-level process-restart tests (`docs/RC_FAILURE_RECOVERY_MATRIX.md`
scenarios A/B, `docs/RC_INVENTORY_INVARIANTS.md` §6), not assumed from
architecture alone.

Mercado Pago remains, as required, reported as **EXTERNAL PROVIDER
ACTIVATION PENDING** rather than any shade of red — its own code is real and
was read, not exercised live, per the freeze policy's explicit instruction.
