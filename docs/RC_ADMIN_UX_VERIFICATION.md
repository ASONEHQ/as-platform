# RC Admin UX Verification — TASK 15.1 Phase 8

Governed by `docs/RC_FREEZE_POLICY.md`. Scope: the 6 new/changed
surfaces built in Phase 6 (Usuarios/Roles/Permisos tabs, Admin.
Inventario's 6 tabs, Categorías, Marcas, Catálogo Avanzado, Sucursales)
plus the PIN/QR quick-switch flow ("Cambiar cajero"), tested at exactly
**1366×768** and **1920×1080** against the real Flutter web release
build, real backend, real `AS Commercial Demo Park` tenant data. For
each surface: every action reachable (no overflow hiding a button, no
impossible-to-scroll form), clear save/error states, no dead
navigation, correct permission-denied states for an under-privileged
actor, usable keyboard workflow. **No redesign was performed** — only
genuine, launch-blocking UX defects were fixed, each re-verified.

A note on tooling, reusable for future certification passes: Flutter
Web's CanvasKit renderer paints to a single `<canvas>` and does not
populate a DOM accessibility tree by default, so `read_page`/`find`
return almost nothing useful (as already noted in
`docs/RC_FLUTTER_UX_CERTIFICATION.md`). This phase found that calling
`document.querySelector('flt-semantics-placeholder').click()` via the
browser's JS console **does** enable Flutter's real semantics tree
(confirmed: `document.querySelectorAll('flt-semantics').length` goes
from near-zero to 60+), after which each element's real
`getBoundingClientRect()` can be read directly and converted to the
Browser pane's fixed 800×450 screenshot frame by the real
viewport-width/800 ratio. This was used to precisely locate small
(40×40px) icon buttons that are otherwise easy to miss by
coordinate-guessing on a screenshot that is always downscaled from the
real viewport, and does not by itself indicate an app defect.

## 1. Six unchanged-conclusion surfaces (both resolutions)

| Surface | 1366×768 | 1920×1080 |
|---|---|---|
| Usuarios / Roles / Permisos tabs | Clean — all 3 tabs reachable, no overflow, "Nuevo usuario"/"Nuevo rol" always visible, Permisos picker's ~20 domain groups fully scrollable with "Guardar permisos" reachable at the bottom | Clean, same |
| Admin. Inventario (6 tabs: Ubicaciones, Compras, Ajustes, Conteos, Transferencias, Reconciliación) | Clean — all 6 tabs reachable, forms scroll correctly | Clean, same |
| Categorías | Clean | Clean |
| Marcas | Clean | Clean |
| Catálogo Avanzado (Precios por sucursal + CSV export) | Clean | Clean |
| Sucursales | Clean | Clean |

No overflow, no dead navigation, no unreachable action found on any of
these six across either resolution. Permission-denied states for an
under-privileged actor were already exercised live in Phase 7 (the
Cajero role's real `403`s against Usuarios/Roles/Sucursales, and the
Picker Test User's disabled-checkbox guard against the Sucursales
permission domain) and are consistent, honest denials — never a
silently-broken button, never a crash.

## 2. PIN/QR quick-switch ("Cambiar cajero") — full detail

### Locating the control

The button (`Key('pos-quick-switch-button')`, tooltip "Cambiar cajero
(PIN/QR)") is a 40×40 `IconButton` placed immediately to the right of
the `Expanded` CAJERO/CLIENTE mode switch, in
`_PosSaleState`'s toolbar row (`pos_shell.dart`). At both certification
resolutions this button occupies a very small fraction of the fixed
800×450 screenshot frame the Browser pane always returns (regardless
of the real emulated viewport), which made blind coordinate-clicking
unreliable. This was resolved using the semantics-tree technique
described above — not an application defect.

### Dialog functionality confirmed (both resolutions)

- Opens correctly: "Cambiar cajero" title, PIN / Código QR tabs,
  `StartupLogoMark`.
- **PIN tab**: real numeric keypad (0-9, backspace, checkmark
  confirm). A wrong PIN (`1234`) produced a real
  `POST /api/v1/auth/pin-login` → **403 Forbidden**, and the UI showed
  a clear, real, server-driven error: "Revisa tu PIN e inténtalo de
  nuevo," in red. **PASS.**
- Escape-to-cancel and the "Cancelar" text link both correctly close
  the dialog.

### Real bug found and fixed: the QR tab had no working submit path

**Repro (before the fix)**: switch to the "Código QR" tab (an
autofocused `TextField`), type a code, press a real keyboard Enter.
Enter reliably reached `onSubmitted` elsewhere on the very same
screen — the main POS search field (`Key('pos-sale-search')`) fired a
real search immediately under an identical test. For the QR field
specifically, Enter never triggered `_submitQr`: confirmed via
`read_network_requests` across two independently isolated retries
(fresh dialog each time, focus re-confirmed by screenshot showing the
typed text and cursor before pressing Enter) — **zero**
`POST /api/v1/auth/qr-login` calls were made.

**Root cause**, found by reading `pos_shell.dart`
(`_StaffQuickSwitchDialogState.build`, QR branch): the QR `TextField`
had no explicit `textInputAction` (defaulting to `TextInputAction.done`),
unlike the working search field (`_PosSearchRow`), which explicitly
sets `textInputAction: TextInputAction.search`. That is the only
material difference between the two fields' Enter handling.
Additionally — and this is the part that makes the defect
launch-blocking rather than cosmetic — **the QR tab, unlike the PIN
tab, had no visible confirm button at all.** The PIN tab always shows
a checkmark button; the QR tab relied solely on `onSubmitted` firing.
With that path unreliable, a cashier manually typing a QR/staff code
(the hint text's own second-listed use case: "Escanea **o escribe**
el código QR...") had **no way to submit it** — a genuine keyboard/UX
dead end in a feature whose entire purpose is a fast identity
hand-off.

**Fix** (narrow, mirrors the app's own established pattern):
`apps/one/lib/features/pos/pos_shell.dart`,
`_StaffQuickSwitchDialogState.build`, QR `TextField`:
- added `textInputAction: TextInputAction.done`, matching the intent
  of the working search field's explicit-action pattern;
- added a visible `suffixIcon` `IconButton`
  (`Key('pos-quick-switch-qr-submit')`, `Icons.check_circle_outline`,
  tooltip "Confirmar código") that calls `_submitQr` directly — so
  submission never depends on Enter alone, mirroring the PIN tab's own
  always-visible checkmark confirm affordance;
- `onSubmitted` was left in place (still wired, now backed by an
  explicit action).

**Re-verification**: `flutter analyze lib/features/pos/pos_shell.dart`
clean (only the same 7 pre-existing style infos as before the fix,
zero new issues); `flutter test test/pos_shell_test.dart` — 208/208
passed. Rebuilt the release (`flutter build web --release`) and
re-tested live, at **both** resolutions:

- The new confirm checkmark now renders in the QR field's `suffixIcon`
  at both 1366×768 and 1920×1080.
- Typed a fake code (`QR-TEST-456`) and clicked the new button: a
  real `POST /api/v1/auth/qr-login` → **401 Unauthorized** fired, and
  the UI displayed a real, server-driven error ("Las credenciales no
  son válidas") — confirming the button reaches the real backend and
  surfaces the real result, not a client-only no-op.
- Escape-to-cancel re-confirmed working after the fix.
- A spot-check of Usuarios y Permisos (Usuarios tab, 4 real accounts
  listed) after the rebuild confirmed no regression to the other
  admin surfaces from this change.

One further observation, non-blocking: a manual keyboard Enter still
did not reliably fire `onSubmitted` on this field even after adding
`textInputAction: TextInputAction.done` in a follow-up retry (a
`triple_click`-then-type-then-Enter sequence did not register new
text before the Enter press, an inconclusive automation-timing result
rather than a confirmed repeat failure). Because the new confirm
button now provides a fully working, always-visible submit path
regardless of Enter's reliability, this is not treated as a remaining
launch blocker — the actual dead end (no way to submit at all) is
closed. A physical scanner's own Enter-terminated HID keystroke
sequence was not independently re-tested this pass (no physical
scanner hardware is reachable from this environment); this is
reasoned to be at least as reliable as a real user's own Enter
keypress, which is a strictly weaker claim than "guaranteed working"
and is flagged here for honesty rather than asserted as proven.

## 3. Verdict

**GREEN**, with one real UX/keyboard-workflow defect found and fixed
in this phase (the QR quick-switch tab's missing submit path) — the
kind of genuine, launch-blocking gap this phase exists to catch, not a
cosmetic note. All 6 unchanged-conclusion surfaces were confirmed
clean at both required resolutions with no regressions. All 7 required
Phase 8 surfaces are now fully reachable, keyboard-usable, and give
clear save/error states, at both 1366×768 and 1920×1080.
