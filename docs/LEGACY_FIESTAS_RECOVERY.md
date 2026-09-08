# Legacy Fiestas Recovery

**Source of truth**: `C:\Users\InMagic\Downloads\punto de venta INFLAPARK\AS POS V1.html`
(the canonical AS POS V1 prototype, 14,712 lines, single-file HTML+CSS+JS, entirely in
Spanish). Inspected in full via forensic sub-agent (grep-located, then read
in context — every claim below cites a real line number in that file).

**Why this document exists**: an earlier pass of this task concluded
Events/Parties/Scheduling was "genuinely unbuilt... no schema, module,
route, or Flutter screen exists anywhere" — true of the *current*
Flutter+Fastify+PostgreSQL repository, but that repository is not the
whole product history. The user confirmed with visual evidence that
"Fiestas" existed as a real menu item in the original AS POS V1 product,
and this document proves it was substantially built, not just a label —
see the classification table below. See [[LEGACY_FUNCTIONAL_PARITY]] for
how this fits into the full product, and [[V1_POST_LAUNCH_BACKLOG]] for
where a real rebuild is now scoped.

---

## Where it lived

- Sidebar nav: `Fiestas` (line 997), one of four items under the
  **CLIENTES** group (Clientes / Fiestas / Membresías / Cupones-Promos) —
  exactly matching the visual evidence.
- Page container `#p-fiestas` (line 1598), titled "Fiestas /
  Reservaciones," with 4 tabs: **Lista** (1615), **Calendario** (1634),
  **Cotizador** (1677, an interactive price-quoting tool), **Ajustes**
  (1682, admin CRUD for Paquetes and Salones).
- Real wiring, not a dead link: clicking the nav item calls
  `_navInterno('fiestas', btn)` → `renderFiestas()` (line 4821).

## Classification legend (this document)

- **A** — real, working feature (real logic wired to real DOM/state)
- **C** — visual placeholder only (label/button with no real behavior)
- **D** — genuinely absent (searched specifically, found nothing)

## Capability-by-capability recovery

### 1. Reservation record — data model

| | |
|---|---|
| **LEGACY UI** | Multi-tab creation/edit modal `modal-fiesta` (line 3014) — cliente, tel, festejado, edad, domicilio, fecha, hora, hora-fin, estado, sala, niños, sucursal, vendedor, paquete (free-text w/ autocomplete), saldo, anticipo, cuenta (abierta/cerrada), notas, calcetas (socks) by size, snacks, document upload slots. |
| **LEGACY BEHAVIOR** | `saveFiesta()` (9102-9203) validates nombre+fecha required, checks room conflict before allowing save, writes/updates a full in-memory record. |
| **LEGACY DATA MODEL** | A `fiesta` object with ~24 fields (see full field table below) — no structured price breakdown, no `clienteId` FK (cliente is free text only). |
| **LEGACY WORKFLOW** | Create (`abrirNuevaFiesta`, also reachable from calendar day-click or Cotizador "Convertir a reservación") → edit (PIN-gated) → `estado` changed directly on the same form (no separate "confirm" step) → delete (PIN-gated). |
| **CURRENT AS-PLATFORM EQUIVALENT** | None. No `parties`/`fiestas`/`reservations` table, module, or route exists anywhere in the current repository (task/12-2, main, task/12-2b all checked). |
| **MISSING PORT** | Everything — this is a full domain gap, not a partial one. |
| **V1 REQUIREMENT** | Scoped as its own dedicated future task per explicit user decision (TASK 14.2). Not attempted here. |
| **Classification** | **F — legacy feature not ported** |

Full field list, each traceable to a real form input or object-literal
property (see the forensic agent's line-by-line table for exact
citations): `id, cliente, tel, festejado, edad, domicilio, fecha, hora,
horaFin, estado, sala, ninos, sucursal, vendedor, paquete, saldo,
anticipo, cuenta, notas, calcetas[], calcetasTotal, calcetasDescontadas,
snacks[], docDeslinde, docContrato, docFechaCreacion, archivoDeslinde,
archivoContrato`.

### 2. Room double-booking conflict detection

| | |
|---|---|
| **LEGACY UI** | Enforced silently at save time and inside the Cotizador's room picker (greys out unavailable salones, "Ocupado por X"). |
| **LEGACY BEHAVIOR** | `hayConflictoFiesta(fecha, sala, horaIni, horaFin, excludeId)` (9089-9100) — a real overlap check (`ini < fFin && fIni < fin`), excludes cancelled reservations. |
| **LEGACY DATA MODEL** | Compares `fecha`+`sala`+`hora`/`horaFin` across all `DB.fiestas` entries. |
| **LEGACY WORKFLOW** | Called at `saveFiesta()` (blocks with a toast naming the conflicting client) and at Cotizador room-selection time. |
| **CURRENT EQUIVALENT** | None (no reservation concept exists to conflict-check at all). |
| **MISSING PORT** | Full conflict-detection logic, including the buffer/`separacion` field that was captured but — caveat — never actually enforced even in the legacy code (a real, checkable gap in the *original* product, not introduced by migration). |
| **V1 REQUIREMENT** | Required for any real rebuild — this was one of the more genuinely valuable pieces of the legacy module. |
| **Classification** | **F — not ported** (and note: **C** even in the legacy code for the buffer sub-feature specifically) |

### 3. Calendar (Month/Week/Day/List views)

| | |
|---|---|
| **LEGACY UI** | Full calendar tab with Mes/Semana/Día/Lista view switcher, sucursal/salón/estado/vendedor filters, day-click opens an agenda modal. |
| **LEGACY BEHAVIOR** | `renderCalendarioFiestas()` (6808-6831) driving `calRenderMes/Semana/Dia/Lista` (6833-6906), `calNav()`/`calHoy()` navigation. |
| **LEGACY DATA MODEL** | Renders directly from `DB.fiestas`, filtered client-side. |
| **LEGACY WORKFLOW** | Browse by period → click a day → see that day's reservations → create new on that date. |
| **CURRENT EQUIVALENT** | None — no calendar/scheduling UI of any kind exists in the Flutter app for any domain. |
| **MISSING PORT** | The entire calendar UI and its real-time conflict-aware rendering. |
| **V1 REQUIREMENT** | Core to any real events module. |
| **Classification** | **F — not ported** |

### 4. Salones (rooms) — admin CRUD

| | |
|---|---|
| **LEGACY UI** | "Ajustes → Salones" admin panel; a rich creation form. |
| **LEGACY BEHAVIOR** | `guardarSalon()` (7841-7871) — real CRUD, no hardcoded list (`salones:[]` starts empty, fully admin-defined). |
| **LEGACY DATA MODEL** | `nombre, descripcion, sucursal, piso, color, capNinos, capAdultos, capTotal, horaApertura/horaCierre, duracionMinima, separacion, estado (activo/mantenimiento/fuera_servicio), caracteristicas{}, fotos[]`. |
| **LEGACY WORKFLOW** | Create/edit/activate-deactivate/delete a room; capacity is enforced in the Cotizador's picker, not in `saveFiesta` itself. |
| **CURRENT EQUIVALENT** | None. (The current platform's `branches`/`inventory_locations` model physical business locations, not bookable event rooms — a genuinely different concept, not a renamed version of this.) |
| **MISSING PORT** | The entire salón entity and its admin CRUD. |
| **V1 REQUIREMENT** | Required for a real rebuild — this was a genuinely well-built sub-feature. |
| **Classification** | **F — not ported** |

### 5. Paquetes (packages) — admin CRUD + pricing

| | |
|---|---|
| **LEGACY UI** | "Ajustes → Paquetes de Fiestas" — a very rich form (general info, included food/decoration/entertainment/gifts, time/extras pricing, restrictions). |
| **LEGACY BEHAVIOR** | Real CRUD (7929-8136), no hardcoded list. |
| **LEGACY DATA MODEL** | `nombre, descripcion, color, estado, precio, precioPromo, duracionMin, ninosIncluidos, adultosIncluidos, costoNinoExtra, costoAdultoExtra, capacidadMaxima, salonesDisponibles[], alimentos{}, pastel{}, decoracion{}, entretenimiento{}, regalos{}, tiempo{}, beneficios[], restricciones{}`. |
| **LEGACY WORKFLOW** | Admin defines a package once; it's then selectable (free-text with autocomplete, not a real FK) on a reservation, or computed live in the Cotizador. |
| **CURRENT EQUIVALENT** | The current platform's real `products`/catalog system is structurally capable of modeling a "party package" as a product with a price, but nothing wires a package's rich structured fields (food/decor/entertainment/time-extension pricing) to anything today. |
| **MISSING PORT** | The rich structured package model and its live pricing computation. |
| **V1 REQUIREMENT** | Required — this was the most structurally rich part of the legacy module and directly informs what a real "party package" entity needs to hold. |
| **Classification** | **F — not ported** |

### 6. Cotizador (interactive quoting tool)

| | |
|---|---|
| **LEGACY UI** | A dedicated tab that live-computes a quote as an operator adjusts kids/adults/time/extras, with "Convertir a reservación" to pre-fill a new booking. |
| **LEGACY BEHAVIOR** | `cotizadorActualizar()` (8335-8340, duplicated at 8385-8390/8421-8426) computes `base + ninosExtra + adultosExtra + tiempoExtraCosto + extrasCosto`. |
| **LEGACY DATA MODEL** | Reads live from the paquete/salón catalog; writes only a final total string into the reservation's free-text `saldo` field — no structured price breakdown is persisted. |
| **LEGACY WORKFLOW** | Pick package → adjust guest counts/time/extras → see live total → optionally convert straight into a reservation. |
| **CURRENT EQUIVALENT** | None as a party-specific tool, though the current platform's real, tested pricing engine (promotions/discounts/tax computation) is the right foundation to build an equivalent on. |
| **MISSING PORT** | The entire live-quoting UI and its price-composition logic (kept structured this time, unlike the legacy's collapse-to-one-string approach). |
| **V1 REQUIREMENT** | High-value UX piece if rebuilt — genuinely useful for a real sales conversation with a customer. |
| **Classification** | **F — not ported** |

### 7. Deposit (anticipo) / balance (saldo) tracking

| | |
|---|---|
| **LEGACY UI** | Two independent fields on the reservation form. |
| **LEGACY BEHAVIOR** | No automatic 50%-anticipo rule enforced despite the printed contract stating "50% a la firma" — that's contract boilerplate text only, never validated against the real field. `calcularTotalFiesta()` = `anticipo + saldo`, nothing more sophisticated. |
| **LEGACY DATA MODEL** | Two free-form money fields, no ledger, no payment linkage. |
| **LEGACY WORKFLOW** | Type a number in each field; nothing reconciles them against a real payment. |
| **CURRENT EQUIVALENT** | The current platform's real `payments`/`sales` financial model (server-authoritative, idempotent, audited) is the right foundation — genuinely stronger than what the legacy had — but nothing wires a deposit/balance-due concept to it today. |
| **MISSING PORT** | A real deposit + remaining-balance ledger tied to actual payments, not two free-text fields. |
| **V1 REQUIREMENT** | Required, and should be built *better* than the legacy version (real payment linkage, not just two numbers). |
| **Classification** | **C — partially ported in spirit only** (the current platform's payment infrastructure is more capable, but nothing connects it to a deposit/balance concept) |

### 8. Cancellation → refund of anticipo

| | |
|---|---|
| **LEGACY UI** | Cancelling just means setting `estado='Cancelada'` on the same edit form. |
| **LEGACY BEHAVIOR** | No refund logic anywhere — confirmed absent by targeted search. |
| **CURRENT EQUIVALENT** | None (no reservation to cancel). |
| **MISSING PORT** | This was never really built even in the legacy product — a genuine, pre-existing gap, not something migration lost. |
| **V1 REQUIREMENT** | Should be built for real this time, reusing the current platform's actual refund infrastructure ([refunds.routes.ts](apps/api/src/modules/refunds/refunds.routes.ts)). |
| **Classification** | **D — genuinely never implemented in the original product** |

### 9. Contract (contrato) + waiver (deslinde) generation

| | |
|---|---|
| **LEGACY UI** | "Ver documento" / "Imprimir" / "Descargar" / "Enviar por WhatsApp" actions from the reservation detail view. |
| **LEGACY BEHAVIOR** | `generarHtmlCaratulaFiesta()` (7181-7228) and `generarHtmlContratoFiesta()` (7229-7297) build real HTML documents (a 15-clause Spanish legal contract, auto-filled from the reservation), opened via `window.open`+`document.write` and sent to a real `window.print()`. "Descargar" is **not** a real file export — it's a toast telling the user to choose "Save as PDF" in the print dialog. WhatsApp send opens a `wa.me` text-only link; it cannot attach the actual document (manual step required). |
| **LEGACY DATA MODEL** | Templates pull `cliente/tel/domicilio/paquete/vendedor/sala/totals/notas` directly from the reservation object; amounts are spelled out in words via `numeroALetrasMXN()`. |
| **LEGACY WORKFLOW** | Generate → print (real) or manually save-as-PDF from the print dialog (not a real download) → optionally share a WhatsApp text nudge. A separate manual-upload path (`marcarDocCargado`) stores a signed paper contract as base64 directly on the in-memory reservation object via `FileReader` — never uploaded to any server. |
| **CURRENT EQUIVALENT** | The current platform's real receipt-printing mechanism (`receipt_html.dart`/`receipt_print_web.dart`, browser print, proven and tested) is a legitimate, stronger foundation for a real contract-print flow — but nothing generates a party contract today. |
| **MISSING PORT** | Real contract/waiver template generation, tied to real party data, with a genuine document-storage backend (the legacy's "store as base64 on an in-memory object" pattern must NOT be replicated — see the security note below). |
| **V1 REQUIREMENT** | Required for any real rebuild; should use real server-side document storage, not base64-in-memory. |
| **Classification** | **F — not ported** (print mechanism itself is **H — safely replaceable** by the platform's already-proven browser-print pattern) |

**A decoy worth flagging explicitly**: the legacy app's generic "Documentos"
hub page has an unrelated card labeled "Contrato de fiesta" whose
`onclick` is *only* `toast('Generando contrato...')` — pure placeholder,
completely disconnected from the real generator described above. Anyone
using that hub page would have believed contract generation didn't work
at all, when a real (if manually-print-only) implementation existed one
click away in the actual Fiestas module. This is a genuine legacy-product
UX bug, not a migration artifact.

### 10. Vendedor (salesperson) assignment

| | |
|---|---|
| **LEGACY UI** | A free-choice select on the reservation form, defaulting to the logged-in user. |
| **LEGACY BEHAVIOR** | Used for calendar filtering, printed on the contract, shown on calendar cards. No commission calculation anywhere. |
| **CURRENT EQUIVALENT** | The current platform's real `created_by`/audit-log actor tracking is a stronger foundation (server-authoritative, not a free-text select) — but there's no reservation to attribute yet. |
| **MISSING PORT** | Attribution-only tracking; commission math would be new, not recovered (it never existed). |
| **V1 REQUIREMENT** | Straightforward if rebuilt on top of real actor/audit tracking. |
| **Classification** | **F — not ported** |

### 11. Calcetas (party socks) inventory + snacks add-ons

| | |
|---|---|
| **LEGACY UI** | Per-size (XS/S/M/L) quantity inputs on the reservation form; a snacks line-item list. |
| **LEGACY BEHAVIOR** | `descontarCalcetasFiesta()` (9205-9232) — a real, one-way stock deduction against `DB.tienda` inventory via `registrarKardex`, guarded against double-discount. |
| **CURRENT EQUIVALENT** | The current platform's real inventory system ([inventory.routes.ts](apps/api/src/modules/inventory/inventory.routes.ts), real balances/movements/reconciliation) is directly capable of this — genuinely stronger than the legacy's in-memory Kardex. |
| **MISSING PORT** | Just the wiring: a reservation-linked inventory posting, reusing the real `InventoryPostingService` already proven in TASK 14.2's business-config work. |
| **V1 REQUIREMENT** | Should be straightforward to rebuild well, given the current platform's inventory infrastructure is already more capable than the legacy's. |
| **Classification** | **F — not ported, but the underlying current-platform capability is real and superior** |

### 12. Cuenta abierta/cerrada (running account toggle)

| | |
|---|---|
| **LEGACY UI** | A simple toggle, independent of `estado`. |
| **LEGACY BEHAVIOR** | `toggleCuenta()` flips a field, logged to bitácora. |
| **CURRENT EQUIVALENT** | None. |
| **Classification** | **F — not ported** |

### 13. Role-based permission gating (`verFiestas`/`gestionarFiestas`)

| | |
|---|---|
| **LEGACY UI** | Toggleable in the Usuarios → role-permissions editor matrix. |
| **LEGACY BEHAVIOR** | **Defined but never enforced** — `puedeHacer('verFiestas')`/`puedeHacer('gestionarFiestas')` are never called anywhere in the codebase (confirmed: only 5 other permission checks are actually consulted app-wide). The Fiestas nav item renders unconditionally for every logged-in user regardless of role. |
| **CURRENT EQUIVALENT** | The current platform's real, server-enforced permission system ([auth.guards.ts](apps/api/src/modules/auth/auth.guards.ts), `requirePermission`) is categorically stronger — every permission check in the current platform actually gates the corresponding route. |
| **MISSING PORT** | N/A — there's nothing to port here; the legacy behavior (decorative-only permission flags) must specifically NOT be replicated. Any real events module must have its permissions genuinely enforced from day one, unlike its legacy ancestor. |
| **V1 REQUIREMENT** | A real `party.read`/`party.manage`-style permission pair, actually checked server-side. |
| **Classification** | **H — the current platform's real permission enforcement is already a strictly better replacement for this specific (broken) legacy mechanism** |

### 14. Admin-PIN gating on edit/delete/create-package

| | |
|---|---|
| **LEGACY BEHAVIOR** | `pedirPinAdmin()`/`requiereMasterOAdmin()` genuinely block the action until a PIN matching a plaintext-stored value (or the hardcoded master backdoor) is entered. |
| **CURRENT EQUIVALENT** | The current platform's real JWT-based auth + server-enforced permissions ([auth.service.ts](apps/api/src/modules/auth/auth.service.ts)) is categorically more secure — no plaintext PIN comparison, no hardcoded backdoor account, real session tokens. |
| **Classification** | **H — safely replaced.** Proof of equivalence: the legacy mechanism is a client-side-only, plaintext-comparable, backdoor-bypassable gate (see [[LEGACY_FUNCTIONAL_PARITY]]'s Auth section for the exact hardcoded credential found: `user:"asmaster", pass:"asmaster2604", pin:"2604"`); the current platform's auth is server-authoritative, hashed, tenant-isolated, and has no such override. This must never be re-introduced. |

### 15. Dashboard "Fiestas hoy" KPI / Reportes → Fiestas tab

| | |
|---|---|
| **LEGACY BEHAVIOR** | Two of four KPIs (`rfie-mes`, `rfie-proximas`) are genuinely recomputed from `DB.fiestas`; the other two (`rfie-ingresos`, `rfie-anticipos`) are **permanently stuck at hardcoded HTML placeholder values** ("$36,000"/"$4,400") — `renderRepFiestas()` never touches them. This is a real, checkable bug in the *legacy* product itself. |
| **CURRENT EQUIVALENT** | None (no reservation data to report on). |
| **V1 REQUIREMENT** | Any rebuilt reporting must compute all four figures for real — do not reproduce the legacy's half-fake KPI pattern. |
| **Classification** | **F — not ported** (with an explicit warning about which parts of the legacy version were themselves fake) |

### 16. Persistence

| | |
|---|---|
| **LEGACY BEHAVIOR** | **Explicitly excluded from persistence.** The only `localStorage` write in the entire legacy app saves `{negocio, usuarios, licencia}` — with a code comment translating to "ONLY business + users + license; operational data is not yet saved." `DB.fiestas`/`salones`/`paquetesFiesta` are pure in-memory JS and vanish on page reload. |
| **CURRENT EQUIVALENT** | The current platform's real PostgreSQL persistence, proven durable across a genuine process kill+restart in this same task's staging rehearsal. |
| **Classification** | **H — the current platform's real persistence is categorically the correct replacement.** This is exactly the mechanism explicitly called out as something to NOT replicate — any rebuild must be durable from day one, unlike its legacy ancestor which never was. |

### 17. Customer linkage

| | |
|---|---|
| **LEGACY BEHAVIOR** | `cliente` on a reservation is a bare free-text name string — confirmed zero `clienteId`/FK into `DB.clientes` anywhere in the file. |
| **CURRENT EQUIVALENT** | The current platform's real `customers` table + FK pattern (already proven throughout sales/rewards/refunds) is directly capable of a real linkage. |
| **V1 REQUIREMENT** | A real rebuild must link a reservation to a real `customers.id`, not a free-text name — a genuine improvement over the legacy product, not merely parity. |
| **Classification** | **F — not ported, and the current platform's foundation is already better suited to do this correctly** |

### 18. Sample/seed data

No hardcoded example fiesta/salón/paquete records exist anywhere in the
legacy file — `DB.fiestas`/`salones`/`paquetesFiesta` all initialize to
`[]`. Every "3 fiestas hoy" / "$36,000" style number visible in the
static HTML is baked-in placeholder markup, not derived from a seed
array. **Classification: D — genuinely absent even in the source
product.**

---

## Summary classification table

| # | Capability | Class |
|---|---|---|
| 1 | Reservation data model | F |
| 2 | Room conflict detection | F (buffer field: C even in legacy) |
| 3 | Calendar (Month/Week/Day/List) | F |
| 4 | Salones admin CRUD | F |
| 5 | Paquetes admin CRUD + pricing | F |
| 6 | Cotizador (quoting tool) | F |
| 7 | Deposit/balance tracking | C |
| 8 | Cancellation → refund | D (never existed) |
| 9 | Contract/waiver generation | F (print mechanism: H) |
| 10 | Vendedor assignment | F |
| 11 | Calcetas/snacks inventory | F (current inventory capability: superior) |
| 12 | Cuenta abierta/cerrada | F |
| 13 | Role-permission gating | H (legacy version was broken/unenforced) |
| 14 | Admin-PIN gating | H (current auth is categorically safer) |
| 15 | Dashboard/report KPIs | F (2 of 4 legacy KPIs were themselves fake) |
| 16 | Persistence | H (current durable Postgres replaces broken in-memory-only legacy) |
| 17 | Customer linkage | F (current foundation already superior) |
| 18 | Sample/seed data | D (never existed) |

## Bottom line

**Fiestas was real** — a substantially-built module (calendar with genuine
conflict detection, admin-managed rooms/packages with rich pricing
fields, a live quoting tool, real contract/waiver HTML-print generation,
socks/snacks inventory tied to a real stock ledger) — not a placeholder,
and not something that "never existed." Three things must be stated with
equal clarity, though: **it was never persisted** (pure in-memory, lost
on every page reload, by the legacy code's own explicit admission),
**had no real customer-record linkage**, and **its own permission flags
were decorative** — none of these three should be mistaken for
migration losses; they were gaps in the original product itself. A real
rebuild (scoped separately per the user's own decision) should preserve
the genuinely valuable parts (conflict-aware scheduling, rich
package/room modeling, contract generation, live quoting) while building
them on the current platform's already-proven, categorically stronger
foundations (real persistence, real auth/permissions, real inventory,
real customer records, real payments) rather than reproducing any of the
legacy's insecure or broken mechanisms.

See [[LEGACY_FUNCTIONAL_PARITY]] for how this fits the full-product
picture, [[LEGACY_MISSING_PORTS]] for the P0/P1/P2 prioritization, and
[[V1_POST_LAUNCH_BACKLOG]] for the existing "own dedicated future task"
scoping this now feeds into with concrete detail.
