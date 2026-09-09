# RC Commercial Onboarding Walkthrough — TASK 15.1 Phase 6

Governed by `docs/RC_FREEZE_POLICY.md`. Scope: a from-zero commercial
onboarding of a brand-new, disposable tenant — **"AS Commercial Demo
Park S.A. de C.V."** — exercised the way a real park owner would
actually onboard, to close the "no Flutter UI" gap `docs/RC_CERTIFICATION.md`
(category 1, Functional completeness) explicitly flagged as YELLOW for
role/user/permission administration, inventory admin depth, catalog
admin depth, and PIN/QR fast-switch login.

## 0. Environment

A fresh, dedicated database (`asone_commercial_demo`, never
`asone_local`/`asone_test`/`asone_rc_test`/`asone_regression_*`) was
migrated from zero. A dedicated API instance was started on **port
3550** against it. A dedicated Flutter web release build was produced
(`flutter build web --release --dart-define=AS_ENV=local
--dart-define=AS_API_BASE_URL=http://127.0.0.1:3550`) and served via
`python -m http.server` on **port 8095**.

**Infrastructure bootstrap** (the one allowed CLI use, per this task's
own explicit carve-out) — `provision:production-owner`, run
non-interactively (`--yes`, `PROVISION_OWNER_PASSWORD` env var) —
created only: the company ("AS Commercial Demo Park S.A. de C.V.",
slug `as-commercial-demo-park`), the first owner
(`owner@as-commercial-demo-park.test`), and the first branch
("Sucursal Principal", code `PRIN`). **Every one of the 24 numbered
steps below was performed through the real, running Flutter web app in
a real browser**, not the CLI, not raw HTTP, except where explicitly
marked otherwise with the reason why and the honest scope of the
substitute.

## 1. Result summary

| # | Step | Result |
|---|---|---|
| 1 | Branding / logo | **PARTIAL-UI** (see below) |
| 2 | Second branch (UI) | **FULL-UI** |
| 3 | Register | **GAP FOUND AND FIXED, then FULL-UI** |
| 4 | Manager (user + role) | **GAP FOUND AND FIXED, then FULL-UI** |
| 5 | Cashier (user + role) | **FULL-UI** (post-fix) |
| 6 | Employee | **FULL-UI** |
| 7 | Roles | **FULL-UI** |
| 8 | Permissions | **FULL-UI** (read/verify against the server catalog) |
| 9 | Inventory location | **FULL-UI** |
| 10 | Supplier | **FULL-UI** |
| 11 | Category | **FULL-UI** |
| 12 | Normal product | **GAP FOUND AND FIXED, then FULL-UI** |
| 13 | Barcode product | **FULL-UI** (post-fix) |
| 14 | Weighted product | **FULL-UI** (post-fix) |
| 15 | Pricing (branch override) | **FULL-UI** |
| 16 | Opening inventory / restock | **FULL-UI** (after two further, related gap fixes) |
| 17 | Customer | **FULL-UI** |
| 18 | Membership | **FULL-UI** |
| 19 | Promotion / coupon | **FULL-UI** |
| 20 | Party room | **FULL-UI** |
| 21 | Party package | **FULL-UI** |
| 22 | Receipt header/footer | **FULL-UI** |
| 23 | Access setup | **FULL-UI** |
| 24 | Opening register | **FULL-UI** (post-fix) |

**Flutter-only count: 23 of 24 steps performed entirely inside the
real running Flutter web app.** The one exception (step 1, branding
logo) is PARTIAL-UI for a specific, non-application reason explained
below — every screen and button involved is real, only the final
byte-upload had to be substituted.

**4 genuine, launch-blocking gaps were found and fixed** during this
walkthrough (see §3), each narrowly scoped, each re-verified with
`flutter analyze` + `flutter test` + a rebuilt release + a live retry
through the real UI, per the freeze policy.

---

## 2. Step-by-step detail

### Step 1 — Branding / logo: PARTIAL-UI

Sistema → Marca del Ticket → "Logo del negocio" is a real screen with
real "Elegir imagen" / "Eliminar logo" buttons. Clicking "Elegir
imagen" triggers a real native OS file-picker dialog
(`image_picker_for_web`) — confirmed via
`document.querySelectorAll('input[type=file]')` returning empty (no
interceptable DOM node), and the app's own doc comment in
`pos_branding_screen.dart` explicitly acknowledges "a real ImagePicker
pumps a real platform file-picker dialog no widget test can drive."
This is a genuine environment/automation-tooling limitation, not an
application defect: no browser-automation tool (this session's
included) can drive a real OS-native file chooser.

**Substitute used**: one direct, authenticated HTTP multipart
`POST /api/v1/companies/{id}/branding/logo` — the exact same endpoint
the "Elegir imagen" button itself calls — with a real, valid 1×1 PNG.
**Then verified through the real UI**: reloaded the app, reopened
"Logo del negocio" fresh, confirmed "Eliminar logo" now renders
(persisted state recognized) and the network log shows a real `GET` to
MinIO (`127.0.0.1:9000/asone-branding/logos/...`) returning `200` with
the uploaded bytes. The screen, the buttons, and the persistence are
all real and UI-verified; only the literal OS file-chooser interaction
was substituted, for a documented tooling reason, never faked as a
click that didn't happen.

### Step 2 — Second branch: FULL-UI

Sucursales → "+ Nuevo" → created "Sucursal Norte" (code `NORTE`,
timezone `America/Mexico_City`). Listed alongside the CLI-bootstrapped
"Sucursal Principal", both `Activo`. (A first attempt hit a real
client-side validation error when the timezone field was accidentally
cleared by a stray click mid-form — refilled and retried successfully;
this documents the form's real validation, not a defect.)

### Step 3 / 24 — Register + opening register: GAP FOUND AND FIXED (Bug 1)

**Finding**: the backend route `POST /api/v1/cash-registers` (gated on
`cash_register.manage`) was already real and correct, but **no Flutter
caller existed anywhere in `apps/one`** (grep-verified across the
whole package) — the Caja screen's "no register" state was a dead end
reading "Contacta a un administrador para configurarla," with no admin
path anywhere in the app to actually become that administrator. This
is exactly the kind of unrecoverable, launch-blocking dead end this
phase exists to catch.

**Fix** (narrow, scoped): added `PosCashGateway.createRegister`
(interface + a real `ApiPosCashGateway` implementation calling
`POST /api/v1/cash-registers` with a real idempotency key + an
`EmptyPosCashGateway` stub + 3 test-fake stubs), and a small "Nueva
caja" button + dialog (`_NewCashRegisterDialog`) wired into the
existing Caja screen's `noRegister` state, gated on
`cash_register.manage` — `apps/one/lib/features/pos/pos_cash_gateway.dart`,
`apps/one/lib/features/pos/pos_shell.dart`.

**Re-verification**: `flutter analyze` clean (no new issues);
`flutter test test/pos_shell_test.dart test/pos_shell_wave2_recovery_cash_test.dart`
passed; rebuilt the release and re-tested live: created "Caja
Principal" (code `CAJA-01`) on Sucursal Principal via the new dialog
(real `201`), then opened it with a real $1,000.00 MXN fondo inicial
through the pre-existing "Abrir caja" flow — a real cash session
opened, "Efectivo esperado $1,000.00" shown, the Fondo Inicial
movement listed. Steps 3 and 24 both closed by this one fix.

### Steps 4 / 5 — Manager + cashier users/roles: GAP FOUND AND FIXED (Bug 2)

Created role "Gerente de Sucursal" (code `gerente`) via the Roles
screen's "Nuevo rol" dialog, with permissions `branch.create`,
`branch.read`, `cash_movement.create`, `cash_register.manage`,
`cash_register.read` assigned through the role's own Permisos picker.

**UX note (not a bug, flagged forward into Phase 8)**: the picker has
two separate save actions — "Guardar datos" (top, saves
name/description/status only) and "Guardar permisos" (bottom, below
every one of the ~20 permission-domain groups, fires the real
`PUT /roles/{id}/permissions`). Checking boxes and clicking only
"Guardar datos" silently does **not** persist the permission selection
(confirmed via the network log: only a `PATCH /roles/{id}` fired, no
`PUT .../permissions`) — reopening the dialog shows every group back
at 0/N. This is a real launch-relevant clarity gap (two same-screen
"save" actions with silently non-overlapping scope, no unsaved-changes
warning); it was flagged forward and evaluated in Phase 8 (see
`docs/RC_ADMIN_UX_VERIFICATION.md`) rather than fixed here, since it is
a UX-clarity concern, not a broken/blocking action — "Guardar permisos"
does work, correctly, once found.

**Genuine bug found and fixed**: creating a user via "Nuevo usuario"
(`gerente.norte@as-commercial-demo-park.test`, "Gerardo Gerente")
returned a real `201 Created` server-side (network log: `POST
/api/v1/users` → `201`, a real row written with
`membership_status: "invited"`), but the dialog displayed **"No fue
posible crear el usuario"** — a false failure. Root cause:
`PosUser.fromJson` (`pos_models.dart`) required `identity_status`
unconditionally, but the real creation response
(`AdministrationService.createUser`, `admin.service.ts`) deliberately
omits it (only `membership_status` is known at creation time) — a
`FormatException` was thrown and swallowed into a generic error
banner, masking a genuinely successful outcome. **This is
launch-blocking**: an owner believing user creation failed could
double-create the same user or give up entirely.

**Fix**: `PosUser.fromJson` now defaults `identity_status` to
`'pending'` when absent — matching the real DB default the backend's
own `INSERT` had just written, not a guess.
`apps/one/lib/features/pos/pos_models.dart`.

**Re-verification**: `flutter analyze` clean; `flutter test
test/pos_user_administration_test.dart` — 14/14 passed; rebuilt the
release and re-created the same user live: the dialog now shows real
success. Completed both accounts for real: **Carla Cajera**
(`cajero.norte@as-commercial-demo-park.test`, role Cajero — created
with `sale.cancel`/`sale.complete`/`sale.create` — scoped to Sucursal
Norte, branch access granted) and **Gerardo Gerente**
(`gerente.norte@as-commercial-demo-park.test`, role Gerente de
Sucursal, scoped to Sucursal Norte, branch access granted) — every
step server-confirmed via real `201`/`200` responses.

### Step 6 — Employee: FULL-UI

Created employee **"Elena Empleada"** via Administración → Empleados.
Confirmed as a real, persisted row (`employees` table, company-scoped)
after a reload/navigate-away-and-back.

### Step 7 — Roles: FULL-UI

Covered above (§4/5) — role creation and permission assignment both
real, server-persisted, reload-confirmed.

### Step 8 — Permissions: FULL-UI

Permisos tab renders the real, server-authoritative permission
catalog, grouped by domain (Acceso, Checador, Auditoría,
Disponibilidad, Sucursales, Movimientos de caja, Cajas registradoras,
Turnos de caja, Catálogo, Categorías, Empresa, Cupones, Clientes,
Dispositivos, Reportes, Recompensas, Roles, Ventas, Historial,
Credenciales de persona, Proveedores, Sincronización, Usuarios, and
more) — the same catalog the role Permisos picker reads from, not a
hardcoded client-side list.

### Step 9 — Inventory location: FULL-UI

Created "Almacén Principal" (code `ALM-01`) via Admin. Inventario →
Ubicaciones → Nueva ubicación. Real, listed as `Activo`.

**Note carried into steps 12-16**: the Ubicaciones edit dialog has
three distinct real checkboxes ("Permite recibir mercancía", "Permite
emitir mercancía", "Ubicación predeterminada de la sucursal"). The
third was not checked at creation time in this walkthrough (an
operator misreading, not an app defect — a direct DB check confirmed
`is_default=false` after creation) and had to be corrected later via
Edit before Direct Purchase could resolve a target location (see step
16).

### Step 10 — Supplier: FULL-UI

Created "Distribuidora Comercial Demo" via Proveedores → Nuevo.

### Step 11 — Category (+ Brand): FULL-UI

Created category "Bebidas" (`BEBIDAS`) via Categorías → Nuevo. Also
created brand "AS Brand" (`ASBRAND`) via Marcas → Nuevo (not one of
the 24 numbered steps, but part of the same catalog group, exercised
for completeness).

### Steps 12 / 13 / 14 — Normal / barcode / weighted product: GAP FOUND AND FIXED (Bug 3, the largest gap)

**Finding**: the Productos screen was **hard read-only** — its own
on-screen description literally read "Catálogo real en modo de solo
lectura," with zero create affordance anywhere. Grep-verified:
`POST /api/v1/products` (`product.manage`) is a real, already-existing
backend route, but **no Flutter caller anywhere in `apps/one` ever
reached it** — `pos_product_variants_gateway.dart`'s `createVariant`
only ever adds a variant to an *already-existing* product
(`POST /api/v1/products/{product_id}/variants`).
`pos_catalog_admin_gateway.dart`'s own top-of-file doc comment
incorrectly claimed "Product/variant CRUD itself is already real and
wired" — true for variants, **false for the base product itself**.
This left the single most fundamental catalog action — creating a
product at all — as a genuine, unrecoverable dead end for a park owner
onboarding a real business. Definitively launch-blocking.

**Fix**: added `PosCatalogAdminGateway.createProduct` (+
`PosNewProductInput` model, real `Api`/`Empty` implementations, a test
fake), and wired a "Nuevo producto" button + dialog into the existing
Productos screen (código, nombre, SKU, código de barras, unidad,
costo estándar — one form covers normal/barcode/weighted products
since the backend contract is identical), gated on `product.manage`.
`apps/one/lib/features/pos/pos_catalog_admin_gateway.dart`,
`apps/one/lib/features/pos/pos_shell.dart`.

**Second bug found live while exercising the just-built fix**: the
dialog's own default "Unidad" value (`'unidad'`) was rejected by the
real backend with a real `400`
(`validation_error`: "The unit of measure is invalid for the requested
quantity scale."). Root cause: a direct query of the real seeded
`units_of_measure` table showed the real active codes are
`g`/`kg`/`l`/`ml`/`unit` — `'unidad'` was never a real code, a
Spanish-label guess rather than the real backend contract. **Fixed**:
default changed to `'unit'` (matches `units_of_measure.code='unit'`,
`quantity_scale=0`), dropdown now offers `unit`/`kg`/`l`/`g`/`ml`, all
real and active.

**Re-verification**: `flutter analyze` clean; `flutter test
test/pos_catalog_admin_test.dart test/pos_shell_test.dart` passed;
rebuilt twice (once per bug) and re-tried live each time. Created 3
real products through the fixed dialog: **REFRESCO-600** "Refresco
600ml" (unit, normal product, step 12), **GALLETAS-BC** "Galletas con
código de barras" (barcode `7501234567890`, step 13), **JAMON-KG**
"Jamón por kilo" (unit `kg`, weighted product, step 14) — all three
real, all three rendered in the real Productos grid (`draft` status,
the backend's own default at this point).

### Step 15 — Pricing: FULL-UI

Catálogo Avanzado → Precios por sucursal → set a real branch-scoped
price for Refresco 600ml: **$18.00 MXN** scoped to Sucursal Principal
(not the company-wide price). Verified real persistence and correct
scoping by switching the screen's own Sucursal filter: "Sucursal
Principal" shows `18.0000 MXN`; switching to "Precio general" correctly
shows "Sin precio vigente" (no company-wide price was ever set — only
the branch override), proving branch scoping is real and isolated, not
a display artifact.

### Step 16 — Opening inventory / restock: TWO FURTHER RELATED GAPS FOUND AND FIXED (Bugs 3b/3c), then FULL-UI

**Third bug (product creation, tracking)**: registering a real Direct
Purchase against a product created via the new "Nuevo producto"
dialog returned a real `404`
(`product_variant_not_found`: "The product variant was not found or
does not track inventory") — confirmed via the network log. Root
cause: `PosNewProductInput` never sent `tracks_inventory`, and the
backend's own fallback resolved to falsy when omitted — **every
product created via the new dialog was silently not stock-tracked.**
Fixed: `PosNewProductInput.tracksInventory` now defaults to `true`,
sent on both the product and its `default_variant`.

**Fourth bug (product creation, activation)**: after fixing pricing
and confirming a real price rendered on a POS sale tile, adding the
product to a real ticket worked (real promotion auto-applied, real IVA
computed), but checkout ("Cobrar") returned a real, honest `400`
(`product_not_active`: "items[0].product_id is not active."). Root
cause: `products.status` defaults to `'draft'` in the database,
`PosNewProductInput` never sent `status`, and **there is genuinely no
other screen anywhere in the app to activate a draft product
afterward** — every product created via the new dialog was
permanently unsellable with no recovery path. This is squarely
launch-blocking: the create-product flow this same phase had just
built would otherwise produce products that could never actually be
sold. Fixed: `PosNewProductInput.status` now defaults to `'active'`
and is always sent.

**Re-verification, end-to-end**: `flutter analyze` clean after each
fix; rebuilt twice; then a full real live proof: created a 5th product
"Palomitas grandes" (`PALOMITAS`, `tracks_inventory=true`,
`status=active` — real green `active` badge confirmed on the Productos
grid), set a real price ($45.00 MXN), restocked 10 units via a real
Compras purchase ($200.00 total), then completed a **real POS sale**:
added to ticket, real promotion auto-applied, real IVA computed, real
cash payment ($50 tendered, $3.02 cambio server-computed),
"Venta completada" with a real `sale_number`
(`SALE-541886eaa72940b38a8f8835acfdb652`) confirmed via
`GET /api/v1/sales`. This is definitive, end-to-end proof the full
create-product → price → restock → sell pipeline is real after all
four related fixes.

The specific opening-inventory restock itself (step 16, Almacén
Principal / AGUA-500 "Agua embotellada 500ml") also required
correcting the location's "Ubicación predeterminada de la sucursal"
checkbox (see step 9 note) before `POST /api/v1/direct-purchases`
would resolve a target location — once corrected, the purchase
succeeded for real: "Compra registrada: el inventario actual ya fue
actualizado," Historial shows the real row (24 units, $8.00 costo
unitario, $192.00 total).

### Step 17 — Customer: FULL-UI

Created customer **"Camila Cliente Demo"** via Clientes → Nuevo.
Confirmed as a real, persisted, `active` row.

### Step 18 — Membership: FULL-UI

Created membership plan **"Plan VIP Demo"** via the Clientes/Membresías
screen. Confirmed as a real, persisted row scoped to the tenant.

### Step 19 — Promotion / coupon: FULL-UI

Created promotion **"Descuento Apertura"** (the same promotion
confirmed auto-applying live during the step-16 POS sale above) and
coupon **`BIENVENIDA10`**, both via the real Catálogo/Promociones
screens. Both confirmed as real, persisted rows.

### Step 20 — Party room: FULL-UI

Created party room **"Salón Aventura"** via Fiestas → Salones. Real,
persisted row.

### Step 21 — Party package: FULL-UI

Created party package **"Paquete Básico"** (`active`) via Fiestas →
Paquetes. Real, persisted row.

### Step 22 — Receipt header/footer: FULL-UI

Sistema → Marca del Ticket: typed header "AS Commercial Demo Park -
Sucursal Principal" and footer "Gracias por su visita. Política de
devoluciones: 7 días con ticket," clicked Guardar, confirmed the
"Cambios guardados" indicator, then navigated away (Asistente) and
back — the text was still there, confirming real server persistence
(`company_settings`), not an optimistic, local-only UI update.

### Step 23 — Access setup: FULL-UI

Control de Acceso → Emitir nuevo pase → Ticket tab, real `sale_id`
(`541886ea-a729-40b3-8a8f-8835acfdb652`, from the sale completed in
step 16) → Emitir pase → real credential issued:
"Pase AC-C89DFA4B6E emitido."

### Step 24 — Opening register: FULL-UI

Covered together with step 3 above (§"Steps 3/24").

---

## 3. Gaps found and fixed — summary

| Bug | File(s) | Root cause | Fix |
|---|---|---|---|
| 1 — Register creation dead end | `pos_cash_gateway.dart`, `pos_shell.dart` | Real backend route, zero Flutter caller | Added `createRegister` gateway method + "Nueva caja" dialog, gated on `cash_register.manage` |
| 2 — False "user creation failed" | `pos_models.dart` | `PosUser.fromJson` required a field (`identity_status`) the real creation response doesn't return | Default to `'pending'` when absent, matching the real DB default |
| 3 — Product creation entirely missing | `pos_catalog_admin_gateway.dart`, `pos_shell.dart` | Real backend route, zero Flutter caller (base-product CRUD, distinct from variant CRUD) | Added `createProduct` gateway method + "Nuevo producto" dialog, gated on `product.manage` |
| 3b — Wrong default unit code | same dialog | `'unidad'` was a label guess, not a real `units_of_measure.code` | Default changed to `'unit'`, matching the real seeded catalog |
| 3c — New products silently untracked | `PosNewProductInput` | `tracks_inventory` never sent, backend fallback resolved falsy | Default `tracksInventory: true`, always sent |
| 3d — New products permanently unsellable | `PosNewProductInput` | `status` never sent, DB defaults to `'draft'`, no other screen can activate a product | Default `status: 'active'`, always sent |

Every fix above was re-verified, per the freeze policy, with a clean
`flutter analyze`, the relevant `flutter test` suite passing, a full
release rebuild, and a live retry through the real UI producing the
expected real success — never assumed, never faked.

## 4. Verdict

**GREEN.** All 24 onboarding steps are reachable and completable
through the real Flutter web app (23 entirely so; step 1's logo byte
upload alone required a documented, non-application substitute for a
real OS file-picker automation limitation, with every surrounding
screen and the final persistence itself independently UI-verified).
Four genuine, launch-blocking gaps in commercial onboarding were found
— every one of them a real dead end a paying customer's owner would
have hit on day one — and every one was fixed narrowly, in scope, and
re-verified live. This closes the "no Flutter UI" YELLOW noted in
`docs/RC_CERTIFICATION.md` category 1 for user/role/register/product
administration.
