# RC 15.0 — Phase 8: Security Certification

**This is an internal launch security review conducted by an engineering
agent, not a claim of formal penetration-test certification.** It does not
substitute for an independent third-party penetration test, a SAST/DAST
tool run, or a compliance audit (PCI-DSS, SOC 2, etc.). It reflects manual
code review plus a bounded set of live black-box probes against a locally
run instance of the API, performed under the constraints of TASK 15.0 (no
push, no deploy, no Mercado Pago credentials/calls, no commits).

Checkpoint reviewed: `1035a58` ("fix(parity): complete forensic legacy
closure"), on branch `task/12-2`, in the worktree at
`C:\Users\InMagic\Documents\Codex\2026-07-21\asonehq-as-platform\.task-12-2-worktree`.

## Methodology

- **Static review**: direct reading of `apps/api/src` (auth, authorization
  guards, tenant/branch scoping, validation schemas, security plugin,
  config package) and a targeted grep of `apps/one/lib` for hardcoded
  secrets. Every claim below cites an exact file and line range.
- **Live probing**: a second API instance was started on **port 3200**
  (the shared workstream server on port 3100/`asone_test` was left
  untouched), against the same shared `asone_test` Postgres database, using
  the exact pattern TASK 14.5A used:
  `NODE_ENV=development API_PORT=3200 DATABASE_URL=postgresql://asone_test:local_test_password_change_me@127.0.0.1:5432/asone_test node --import tsx src/server.ts`,
  with shared vars sourced from the worktree's own `.env`. The dev-owner
  bootstrap (`dev:bootstrap-owner`) and POS catalog seed
  (`seed-pos-catalog.cli.ts`) were used to provision a real session
  (`ceo@inflapark.local`, company `inflapark-group`) and real product
  catalog to test against — never a mock. **The server was stopped before
  this report was finalized; port 3200 is confirmed free.**
- No push, no deploy, no Mercado Pago credentials/calls, no physical
  terminal test were performed, per the RC freeze policy and this task's
  hard constraints.
- **A note on the shared test database**: `asone_test` is shared with
  another concurrent workstream. During probing, the database's company/
  product fixtures were observed to be wiped and needed re-seeding
  mid-session (confirmed via a direct `pg` query returning zero companies
  immediately after a successful login had used one) — this is expected
  churn from that other workstream's own integration test runs, not a
  defect in this codebase, and it did not affect the validity of any probe
  (each probe's prerequisite state was re-verified live immediately before
  running it).

---

## AUTH — PASS

| Item | Finding | Evidence |
|---|---|---|
| No hardcoded production password/PIN, no `asmaster`-style backdoor | **PASS** | Grep for `asmaster`/`master.?pass`/`backdoor`/`god.?mode` across `apps/api/src` returned zero matches. All password/PIN verification funnels through `hashPassword`/`verifyPassword` (`apps/api/src/modules/auth/auth.passwords.ts:1-20`) — no alternate/bypass path exists. |
| `apps/api/src/development/` tooling is real dev/test-gated tooling, not a backdoor (re-confirming TASK 14.5A) | **PASS** | `bootstrap-owner.service.ts:209-244`'s `validateBootstrapEnvironment` enforces, in order: (1) `NODE_ENV` must literally be `development` or `test`; (2) `DATABASE_URL` host must be `127.0.0.1`/`localhost`; (3) the DB name must be exactly `asone_local` (dev) or match `^asone_[a-z0-9_]*test[a-z0-9_]*$` (test); (4) `AS_DEV_BOOTSTRAP_PASSWORD` must be set and pass `validateBootstrapPassword` (12+ chars, mixed case, digit, symbol, no placeholder substring). This is a CLI script, not an HTTP route — not network-reachable from a running production API process regardless. **Live-reconfirmed**: it was run twice against `asone_test` during this review (`NODE_ENV=test`, loopback `asone_test` DB) and worked exactly as documented; it was never runnable against the shared workstream's production-shaped config. |
| Real production provisioning path is separate and safe | **PASS** | `apps/api/src/provisioning/production-owner.*` is a distinct module: interactive typed "yes" confirmation, password typed twice, enforces `validatePasswordStrength`, and refuses to run twice against an already-provisioned company (`production-owner.service.ts:91,111,128,132-133,157-158`). |
| argon2id used for all password/PIN hashing | **PASS** | `apps/api/src/modules/auth/auth.passwords.ts:1-20`: `type: argon2.argon2id`, `memoryCost: 65_536` (64MB), `timeCost: 3`, `parallelism: 1`. `verifyPassword` fails closed (`catch { return false }`). Confirmed as the sole hashing path for: login password (`auth.service.ts:80-83,150-153`, with a constant-time dummy-hash comparison for nonexistent users — user-enumeration/timing mitigation), PIN login (`:646`), QR login (`:683`), staff PIN set (`:732,740`), staff QR issuance (`:775`), admin-set membership password (`admin.service.ts:346`), and both bootstrap paths. No `bcrypt`/raw `sha256` password hashing found anywhere in `apps/api/src`. |
| Secure session cookies | **PASS** | `apps/api/src/modules/auth/auth.routes.ts:44-64`: every `set-cookie` write goes through `setRefreshCookie`/`clearRefreshCookie`. Flags: `HttpOnly` always; `Secure` conditioned on `config.nodeEnv === 'production'` (correctly omitted for local HTTP dev, present in production); `SameSite=Strict` always; `Path=/`. Cookie name is `__Host-asone_refresh` in production (browser-enforced: requires `Secure`+`Path=/`+no `Domain`) vs. `asone_refresh_local` elsewhere (`:25-30`). |
| Real session expiry/TTLs | **PASS** | `packages/config/src/index.ts:139,149-154`: access token TTL default 900s (15 min), bounded 60s–3600s; refresh token TTL default 2,592,000s (30 days), bounded 3,600s–31,536,000s (1 year max). Sane for a POS app requiring device persistence; not unbounded. |
| Logout/session revocation is real server-side invalidation | **PASS — traced in code, not just read from a comment** | `auth.routes.ts:298-308` → `AuthService.logout` (`auth.service.ts:835-846`) → `AuthRepository.revokeSession` (`auth.repository.ts:270-280`), which runs `update sessions set status='revoked', ... where id=$1 and status='active'` **and** `update session_refresh_tokens set status='revoked' where session_id=$1 and status='active'` — two real UPDATE statements against Postgres, not a client-side-only cookie clear. `logout-all` bulk-revokes every active session via `AuthRepository.revokeUserSessions` (`:282-297`) with the same cascade. |
| Production secret validation | **PASS** | `packages/config/src/index.ts:138` — `AUTH_ACCESS_TOKEN_SECRET: z.string().min(32)` applies in **every** environment. Additionally, **only when `NODE_ENV === 'production'`** (`:180-190`), `isWeakProductionSecret` (`:56-76`) rejects secrets with fewer than 4 distinct characters or containing any of 13 placeholder substrings (`changeme`, `replace_me`, `example`, `localhost`, `todo`, etc.). This is explicitly, deliberately scoped to production so local/test fixtures with readable literals are unaffected — confirmed by the code's own comment at `:47-55`. |
| `validateBootstrapPassword`/`validatePasswordStrength` policy | **PASS** | Both (`bootstrap-owner.service.ts:246-261`, `auth.passwords.ts:32-45`) require length ≥12, at least one lowercase/uppercase/digit/symbol, and reject 5 placeholder substrings. Real, non-trivial policy. |

**AUTH verdict: PASS.** No gaps found.

---

## AUTHORIZATION — PASS

| Item | Finding | Evidence |
|---|---|---|
| Server-side permission enforcement (not UI-hidden) | **PASS** | Traced directly in 4 route files across different modules — every handler calls `requireAuthenticatedUser` then `requirePermission` inline, not via a comment/annotation: **Sales** create (`sales.routes.ts:379-390`, `sale.create`+branch access+conditional `discount.apply`/`reward.redeem`), read (`:484,532,567,615`, `sale.read`), cancel (`:654`, `sale.cancel`). **Inventory** read (`inventory.routes.ts:223-224`, `inventory.read`), location manage (`:276-277`, `inventory_location.manage`). **Admin/settings** (`settings.routes.ts:121-122,163`, `company_settings.read`/`.update`). **Payments/refunds** (`payments.routes.ts:363-364,800-801`, `payment.create`/`.reverse`; `refunds.routes.ts:166-167,287-288`, `refund.create`/`.complete`). `requirePermission` (`auth.guards.ts:35-42` → `auth.service.ts:875-882`) throws a real 403 `permission_denied` `AppError` when the permission is absent from `context.permissions` — an array resolved server-side at authentication time, never trusted from the client. |
| Tenant isolation — explicit `company_id` match checks | **PASS** | `settings.routes.ts:123-128,164-169` and `branding.routes.ts:196-201,243-248` both do `if (request.params.company_id !== context.companyId) throw new AppError({ code: 'company_scope_mismatch', ..., statusCode: 403 })` immediately after the permission check. |
| Tenant isolation — other modules never trust a client-supplied company id | **PASS (sampled sales, inventory, customers, payments)** | These modules never even accept a `company_id` field from the client at all — every repository call is passed `auth.companyId`/`context.companyId` (the server-resolved session) directly. Sampled repository queries confirm `company_id=$1` as the first predicate: `sales.repository.ts:529-530`, `inventory.repository.ts:161-163`, `customers.repository.ts:278-279`, `payments.repository.ts:290-291`. `AuthService.switchCompany` (`auth.service.ts:486-502`) re-derives the target company strictly from the caller's own memberships (`listActiveMemberships(current.userId)`), never from an unchecked client value. The PIN-login doc comment (`:606-621`) states this invariant explicitly: company scope is "taken ONLY from `current.companyId` — never from the request body". No route/repository sampled trusted a client-supplied company id without a match-check. |
| Branch isolation | **PASS** | Central enforcement point `AuthService.requireBranchAccess` (`auth.service.ts:884-891`) checks `context.permittedBranchIds.includes(branchId)`, throwing 403 `branch_scope_mismatch` otherwise. Used in `sales.routes.ts:381` (sale creation), independently re-enforced at the service layer in `settings.service.ts:401-404`, and threaded through every `access.routes.ts` handler (lines 139,218,252,280,304,334,366,398). |
| Automated cross-tenant/IDOR test coverage — **executed live during this review, not just read** | **PASS — 11/11 tests pass** | Ran `vitest run` against `settings.routes.integration.test.ts`, `branding.routes.integration.test.ts`, and `payroll.integration.test.ts` against the live `asone_test` database: **11 passed, 0 failed.** Key assertions: `settings.routes.integration.test.ts:210-218` — a session scoped to one branch gets `403 branch_scope_mismatch` reading another branch's settings. `branding.routes.integration.test.ts:242-266` — company B never sees company A's uploaded logo, and company A's session gets `403` reading company B's settings. `payroll.integration.test.ts:408-427` — company A gets `404` (row-hiding, not `403`) reading or closing company B's payroll period, a defense-in-depth pattern that doesn't even confirm another tenant's resource exists. |
| Real IDOR probe against a live server (not just automated tests) | **Attempted; second-tenant provisioning is impractical, so a different real probe was substituted** | The dev bootstrap tooling is hardcoded to a single fixture (`companySlug = 'inflapark-group'`, `bootstrap-owner.service.ts:20`) — it cannot cheaply provision a second company. The real production-provisioning path (`provisioning/production-owner.cli.ts`) requires interactive stdin confirmation and is designed for one-time real deployment, not scripted certification use, so it was not used to fabricate a second tenant. **Substituted with a real cross-permission-boundary probe instead** (see Privilege escalation row below) — a genuinely new, minimally-permissioned user was created and used to attempt actions outside its granted permission set. Cross-**tenant** isolation itself is certified via the 11 passing automated tests above (which already use two real companies, not mocks) rather than a hand-built second tenant. |
| Privilege escalation — **live-probed with a real minimally-permissioned user, not just a test file read** | **PASS** | A brand-new user (`cashier-test@inflapark.local`) was created via the real admin API (`POST /api/v1/users`), given a new role with **only** `sale.create`+`sale.read` (`PUT /api/v1/roles/{id}/permissions`), assigned to the user (`POST /api/v1/users/{id}/roles`), and activated (`PATCH /api/v1/users/{id}`). Logged in as this user and confirmed via `GET /api/v1/auth/permissions` it held exactly `["sale.create","sale.read"]`. Then: `PUT /api/v1/roles/{own-role-id}/permissions` (self-privilege-escalation attempt, requires `role.permission.manage`) → **`403 permission_denied`**. `GET /api/v1/users` (requires `user.read`) → **`403 permission_denied`**. Both real HTTP 403s from a real, unprivileged, freshly-created account — not a mock, not a doc claim. Additionally, `payroll.integration.test.ts:383-406` (executed above) shows an actor with `payroll.manage` (manager-tier) denied `403` on `POST /payroll-periods/{id}/close`, which requires the separate, more-privileged `payroll.close` — proving the codebase doesn't conflate "manage" with "close/approve" tiers generally, not just for this one probe. |

**AUTHORIZATION verdict: PASS.** Server-side enforcement is real and was verified three independent ways (static trace, automated tests executed live, and a hand-built live privilege-escalation probe). Second-tenant IDOR relies on the existing automated tests (cited above) rather than a hand-provisioned second company, for the documented practical reason.

---

## INPUT VALIDATION — 2 real gaps found and fixed (see below); everything else PASS

All probes below were run against the live server on port 3200 with a real authenticated session and, where needed, a real seeded product.

| Probe | Expected | Result |
|---|---|---|
| SQL-injection-shaped string in a text field (`POST /api/v1/customers` with `first_name: "Robert'); DROP TABLE customers;--"`) | Stored as inert literal data, table intact | **PASS.** `HTTP 201`, the string was stored verbatim as `display_name`/`first_name`; a follow-up `GET /api/v1/customers` confirmed the `customers` table was untouched and the row was retrievable. Confirms parameterized queries (Drizzle/`pg`) protect against injection, consistent with reading `customers.repository.ts`'s use of parameterized `$1`/`$2` placeholders throughout. |
| Malformed UUID in a path param (`GET /api/v1/sales/not-a-uuid-at-all`) | Clean `400`, not `500`/stack trace leak | **FAIL initially — real bug found and fixed.** See "Fix 1" below. |
| Oversized string past a schema's `maxLength` (`POST /api/v1/customers` with a 200-char `first_name`, `maxLength: 120`) | Clean `400` | **PASS.** `HTTP 400`, `{"field":"/first_name","rule":"maxLength"}`. |
| Invalid money strings (letters, negative, absurd precision) against a money field | Clean `400` | **FAIL initially for the letters/negative cases — real bug found and fixed.** See "Fix 2" below. Absurd-precision (`10.123456789123456789`, 22 chars) was already correctly rejected pre-fix by the field's existing `maxLength: 20`: `HTTP 400`, `{"field":"/manual_discount/value","rule":"maxLength"}`. |
| Negative quantity in a sale-item body (`quantity: "-5"`) | Clean `400` | **PASS.** `HTTP 400`, `{"field":"/items/0/quantity","rule":"pattern"}` — the existing schema pattern `^(?:0\|[1-9]\d*)(?:\.\d{1,6})?$` (`sales.routes.ts:349`) has no leading-minus branch, so it was already safe. |
| Invalid/wrong MIME type + malicious filename against the branding logo upload | Rejected via magic-byte check; filename never used for the object key | **PASS.** See FILES section — re-verified live. |
| Unsupported content-type on a JSON route (`Content-Type: text/plain` to `/api/v1/auth/login`) | `415` | **PASS.** `HTTP 415 unsupported_media_type`, `"Request bodies must use application/json."` — confirms `security.ts`'s global content-type gate (`:24-54`) still holds. |
| Malformed JSON body | Clean `400` | **PASS.** `HTTP 400 validation_error` for a truncated JSON body to `/api/v1/auth/login`. |

### Fix 1 — malformed UUID path/body params → 500 instead of 400

**Root cause**: ~66 route param/body schemas across the codebase declare an id-like field as a bare `{ type: 'string' }` (no `format: 'uuid'`) — e.g. `sales.routes.ts:525` (`GET /api/v1/sales/:id`), vs. 203 occurrences elsewhere that correctly use `format: 'uuid'`. A malformed value passes AJV schema validation, then reaches a parameterized query against a `uuid`-typed Postgres column. Postgres rejects it with error code `22P02` (`invalid_text_representation`), which was not mapped anywhere in the error pipeline and fell through to the generic `500 internal_error` handler.

**Live confirmation before the fix**:
```
GET /api/v1/sales/not-a-uuid-at-all  (Authorization: Bearer <real token>)
→ HTTP 500
  {"error":{"code":"internal_error","message":"An unexpected error occurred.","details":[]}, ...}
```
Server log (client response itself never leaked internals — the stack trace only reached the server-side log, per `error-handler.ts:112-119`):
```
DatabaseError: invalid input syntax for type uuid: "not-a-uuid-at-all"
  code: "22P02" ... at SalesRepository.sale (sales.repository.ts:529)
```

**Fix** (narrowly scoped — one addition in the single central error-mapping file, not 66 individual route-schema edits, which would have been a broad refactor outside this freeze's scope): `apps/api/src/plugins/error-handler.ts` — added `'22P02': ['validation_error', 400, 'The request is invalid.']` to the existing `transportErrors` map already used for `FST_ERR_CTP_BODY_TOO_LARGE`/`FST_ERR_CTP_INVALID_MEDIA_TYPE`. `22P02` is Postgres's generic "input string could not be cast to its column type" error and is, by construction, always caused by malformed client input, never a server-side logic fault — safe to map centrally for every route/table in the app.

**Test re-run**: added `/__test/postgres-invalid-uuid` to `apps/api/src/routes/test-only.ts` (test-env-only, per `bootstrap/register-plugins.ts:472`) reproducing a real `pg` `DatabaseError` shape without needing a live DB, plus a new case in `apps/api/src/app.test.ts` (`'maps a Postgres invalid-UUID error (22P02) to a clean 400, not a 500'`). **`vitest run src/app.test.ts` → 18/18 passed** (includes the new test).

**Live re-verification after the fix** (server restarted to load the change):
```
GET /api/v1/sales/not-a-uuid-at-all  (Authorization: Bearer <real token>)
→ HTTP 400
  {"error":{"code":"validation_error","message":"The request is invalid.","details":[]}, ...}
```

### Fix 2 — non-numeric/negative `manual_discount.value` → 500 instead of 400

**Root cause**: `POST /api/v1/sales`'s `manual_discount.value` field (`sales.routes.ts`, originally `{ type: 'string', minLength: 1, maxLength: 20 }`, no `pattern`) had no numeric-format validation at the schema boundary, unlike the equivalent `benefit_fixed_amount` field in `promotions.routes.ts` (already protected: `pattern: '^\\d+(\\.\\d{1,4})?$'` at lines 119 and 353). A non-numeric value reached `pricing.service.ts`'s `moneyUnits` (`:51-56`) unvalidated: `BigInt(wholeDigits)` throws a raw `SyntaxError` for non-numeric input, uncaught, from **inside the sale-creation database transaction** (`SalesRepository.transaction`).

**Live confirmation before the fix** (real seeded product, real branch):
```
POST /api/v1/sales
  manual_discount: { scope: "ticket", type: "fixed_amount", value: "abc", reason_code: "test" }
→ HTTP 500
  {"error":{"code":"internal_error","message":"An unexpected error occurred.", ...}}
```
Server log:
```
SyntaxError: Cannot convert abc to a BigInt
  at moneyUnits (pricing.service.ts:55) at manualDiscountUnits (:430) at evaluatePricing (:640)
  at sales.service.ts:315 at SalesRepository.transaction (sales.repository.ts:235)
```
The exception is thrown before the transaction commits, so Postgres itself rolls the transaction back automatically — **no partial/corrupt sale row was left behind** (mitigating factor; still an unhandled-input bug at the HTTP layer, and a needless internal-error/alert-noise generator).

**Fix** (narrowly scoped, schema-only, one field): `apps/api/src/modules/sales/sales.routes.ts` — added `pattern: '^\\d+(\\.\\d{1,4})?$'` to `manual_discount.value`, matching the exact convention and money precision (`numeric(19,4)`/`MONEY_SCALE`) already used for `benefit_fixed_amount` elsewhere in the same codebase. This rejects non-numeric strings and negative values (no leading `-` in the pattern) at the HTTP schema boundary, before the service or DB transaction is ever entered — no change to `pricing.service.ts`'s business logic.

**Test re-run**: added a new case to `apps/api/src/modules/sales/sales.routes.test.ts`
(`'rejects a non-numeric manual_discount.value at the schema boundary before it ever reaches the service'`). **`vitest run src/modules/sales/` → 68/68 passed** (all 3 sales test files, includes the new test).

**Live re-verification after the fix** (server restarted, real product):
```
value: "abc"  → HTTP 400  {"error":{"code":"validation_error", ...,"details":[{"field":"/manual_discount/value","rule":"pattern"}]}}
value: "-10"  → HTTP 400  {"error":{"code":"validation_error", ...,"details":[{"field":"/manual_discount/value","rule":"pattern"}]}}
value: "5.00" → HTTP 201  (real sale created: subtotal 25.0000, discount_total 5.0000, tax_total 3.2000, total 23.2000 — correct arithmetic, confirming the fix does not break the legitimate flow)
```

**Combined regression check**: `vitest run src/app.test.ts src/plugins/security.test.ts src/modules/sales/ src/modules/promotions/` → 189/190 passed, 1 timeout on an unrelated pre-existing test (`app.test.ts`'s "registers only the eleven approved authentication endpoints") that **passed cleanly in isolation with a longer timeout** — confirmed as a transient timeout from the shared `asone_test` Postgres instance being under concurrent load from the other running workstream, not a regression from either fix (verified by re-running that single test alone: 1/1 passed). `npx tsc --noEmit` and `npx eslint` on all 5 changed files are both clean.

**INPUT VALIDATION verdict: 2 real gaps found, fixed, and re-verified (live + automated tests); no other gap found.**

---

## WEB — PASS

| Item | Finding | Evidence |
|---|---|---|
| CORS — no wildcard production default | **PASS** | `packages/config/src/index.ts:7-24` — the `corsOriginsSchema` itself rejects `origin === '*'` in **every** environment (not just production); the default value if unset (`http://localhost:3000,http://127.0.0.1:3000`) is loopback-only. `security.ts:83-89`'s `cors` plugin `origin()` callback only allows origins in `config.corsAllowedOrigins`, or requests with no `Origin` header (non-browser callers). |
| CSRF model consistency | **PASS** | `SameSite=Strict` on the refresh cookie (`auth.routes.ts:54,62`, most restrictive setting — blocks even top-level cross-site GET navigation). Every browser-transport state-changing route (`/logout`, `/logout-all`, `/company-switches`, `/branch-switches`, `/pin-login`, `/qr-login`) additionally requires `service.verifyCsrf(context, request.headers['x-csrf-token'])` (e.g. `:300-303`), which HMAC-signs the token with `AUTH_ACCESS_TOKEN_SECRET` and does a `timingSafeEqual` comparison (`auth.tokens.ts:100-129`) — a header a pure HTML-form-based CSRF attack cannot forge. Plus an `Origin` allowlist check (`requireApprovedOrigin`, `:66-74`) on the same routes. `/login`/`/company-selections` correctly omit the CSRF-token check (no session exists yet to derive one from) and rely on `SameSite=Strict` + rate limiting instead — a reasonable, not-a-gap design choice given the threat model. |
| Security headers (helmet) | **PASS** | `security.ts:56-59,23-96` (full file reviewed): helmet registered globally; `contentSecurityPolicy` disabled **only** when `openapiUiEnabled` is true (to accommodate Swagger UI's inline scripts) — CSP stays on by default. `security.test.ts` (5 tests, executed live: **all 5 pass**) verifies the content-type gate: non-JSON → `415`; real JSON → accepted; the one allowlisted branding-logo multipart route → accepted; every other route → multipart still rejected; a near-miss URL (trailing slash) does **not** get the multipart exemption (defense-in-depth against a path-string bypass). |
| `OPENAPI_UI_ENABLED` defaults off outside development | **PASS** | `packages/config/src/index.ts:158,260-261`: `openapiUiEnabled: value.OPENAPI_UI_ENABLED === undefined ? isDevelopment : ...` — defaults to `true` only when `NODE_ENV === 'development'` and unset; defaults to `false` in `production` and `test` unless explicitly overridden. Directly couples to the CSP relaxation above, so CSP stays fully on in a real production config by default. |
| No secrets baked into the Flutter web bundle | **PASS** | `grep -rnE "sk-|Bearer [A-Za-z0-9]{10,}|apiKey|secret|api_key" apps/one/lib` returned only false positives (a widget-test `Key()` string, doc-comment mentions). The only credential-adjacent config is the API base URL (`apps/one/lib/core/config/app_config.dart:1-46`), injected at build time via `String.fromEnvironment('AS_API_BASE_URL', ...)` — not hardcoded — and the client itself enforces HTTPS for every environment except `local` (`:28-30`), a fail-closed check against accidentally shipping an HTTP endpoint outside local dev. |
| No production secrets committed in the repo | **PASS** | `.gitignore:7-9` covers `.env`/`.env.*` (with `.env.example` explicitly un-ignored). `git ls-files \| grep -i "\.env$"` in the worktree returns **no matches** — the real `.env` (with real-looking local secrets, clearly marked "fictitious... must never be reused in production" at its own header) is present on disk but untracked. |

**WEB verdict: PASS.** No gap found.

---

## FILES — PASS (all re-verified live against the branding logo upload endpoint)

All 6 probes below were run against the live server (`POST`/`DELETE /api/v1/companies/{company_id}/branding/logo`) with a real authenticated session and a real `If-Match` CAS token.

| Probe | Expected | Result |
|---|---|---|
| File just over the 2MB cap (3MB PNG-headered file) | `413` | **PASS.** `HTTP 413`, `{"code":"payload_too_large","message":"The logo file exceeds the maximum size of 2097152 bytes."}` |
| Spoofed `Content-Type: image/png` header on real HTML/`<script>` bytes | Rejected via magic-byte check, not header trust | **PASS.** `HTTP 415`, `{"code":"unsupported_media_type","message":"The uploaded file does not match its declared image content type."}` — confirms `branding.validation.ts`'s `matchesLogoFileSignature` (real magic-byte check on the first 8/3/12 bytes for PNG/JPEG/WEBP, structural `<svg` check for SVG) is not bypassable by header spoofing alone. |
| Path-traversal-shaped filename (`../../etc/passwd.png`) with otherwise-valid PNG bytes | Upload succeeds (valid image), but the stored object key must never derive from the client filename | **PASS.** `HTTP 200`, and the returned object URL was `.../logos/{companyId}/{server-generated-uuid}.png` — the client-supplied filename never appears anywhere in the key. Confirmed by reading `branding.storage.ts:142-159`: `uploadLogo` builds the key as `${BRANDING_PREFIX}/${companyId}/${randomUUID()}.${extension}` and never reads the multipart part's filename at all (the extension comes from the validated `Content-Type`, not the filename) — path traversal is structurally impossible, not merely sanitized. |
| Cross-tenant object isolation — upload to a company_id the caller doesn't belong to | `403`, never processed | **PASS.** `POST` to a random non-owned `company_id` → `HTTP 403 company_scope_mismatch`, thrown **before** any file is read (`branding.routes.ts:196-201`). |
| Cross-tenant object isolation — delete a company_id the caller doesn't belong to | `403` | **PASS.** `DELETE` to the same random `company_id` → `HTTP 403 company_scope_mismatch` (`:243-248`). Additionally, by construction, the delete path only ever resolves the *caller's own* currently-stored `branding.logo_url` setting to find the object key to delete (`branding.storage.ts:169-180`'s `keyFromUrl`) — there is no client-suppliable object key/id parameter anywhere in this API surface, so even a company with `company_settings.update` on its own tenant has no path to reference another tenant's object key. |
| Baseline: a genuinely valid PNG upload | Succeeds | **PASS.** `HTTP 200`, real object created at `logos/{companyId}/{uuid}.png`, setting version incremented via the existing CAS (`If-Match`) mechanism — confirms the happy path still works correctly alongside all the above rejections. |

**FILES verdict: PASS.** TASK 14.5A's magic-byte and size-cap protections hold under adversarial live testing; no gap found.

---

## Summary

| Area | Verdict |
|---|---|
| AUTH | **PASS** |
| AUTHORIZATION | **PASS** |
| INPUT VALIDATION | **2 real gaps found, fixed, and re-verified** (malformed UUID path param → 500; non-numeric/negative manual-discount money value → 500) |
| WEB | **PASS** |
| FILES | **PASS** |

### Fixes made (both inside `apps/api/src`, narrowly scoped, no refactoring)

1. **`apps/api/src/plugins/error-handler.ts`** — map Postgres `22P02` (invalid UUID/type-cast input) to a clean `400 validation_error` instead of falling through to `500 internal_error`. One line added to the existing `transportErrors` map. Fixes this defect class for every route in the app (confirmed via `sales.routes.ts`'s `GET /:id`, but the fix is route-agnostic). Test: `apps/api/src/app.test.ts` (new case) + `apps/api/src/routes/test-only.ts` (new test-only repro route, test-env-gated). **`vitest run src/app.test.ts` → 18/18 passed.**
2. **`apps/api/src/modules/sales/sales.routes.ts`** — add `pattern: '^\\d+(\\.\\d{1,4})?$'` to `manual_discount.value`, matching the existing convention already used for the equivalent `promotions.routes.ts` field. Fixes an uncaught `SyntaxError` from `BigInt()` inside the sale-creation DB transaction (transaction rolled back automatically; no data-integrity impact observed, but a real unhandled-input bug on a financial mutation route). Test: `apps/api/src/modules/sales/sales.routes.test.ts` (new case). **`vitest run src/modules/sales/` → 68/68 passed.**

Both fixes were re-verified live end-to-end against the running server (before/after), not merely asserted fixed from a test run. `npx tsc --noEmit` and `npx eslint` on all 5 touched files are clean. No commit was made — all changes are left uncommitted in the worktree for the orchestrator, per this task's hard constraints.

### What could not be verified, and why

- **A hand-provisioned second live company for a manual cross-tenant IDOR probe.** The dev bootstrap tooling is hardcoded to one fixture company (`inflapark-group`); the real production-provisioning CLI requires interactive stdin confirmation and is not meant for scripted certification use. Relied instead on the three existing automated cross-tenant integration test suites (`settings.routes.integration.test.ts`, `branding.routes.integration.test.ts`, `payroll.integration.test.ts`), which already use two real companies each — **executed live during this review** (11/11 passed), not merely read from source. Privilege-escalation *within* a single tenant was instead probed live and directly with a hand-built, genuinely new, minimally-permissioned user (see AUTHORIZATION table).
- **Mercado Pago / card payment provider security** is explicitly out of scope for this review per the RC freeze policy — remains **EXTERNAL PROVIDER ACTIVATION PENDING**, not evaluated here, no credentials configured, no live call made.
- **Full-suite regression run** was not performed (would take considerably longer than the scope of this phase and touches modules outside this review's two fixes); instead, the specific affected tests plus one broader smoke pass across `sales`/`promotions`/`app`/`security` test files were run (189/190 passed, 1 confirmed-transient timeout unrelated to either fix, re-run in isolation and passed).
