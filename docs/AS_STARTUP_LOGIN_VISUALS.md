# AS Startup / Login Visuals (TASK 12.2F)

## Status and authority

- **Task:** TASK 12.2F — canonical startup, activation, and login flow
  visual migration.
- **Scope:** `apps/one/lib/features/authentication/`, `apps/one/lib/app/`
  (Flutter Web).
- **Reference:** `AS POS V1.html`'s `#pos-splash`, `#aspos-wizard`, and
  `#modal-login.gate-activo` — the same canonical HTML used throughout the
  TASK 12.2 arc (SHA-256 `c7fc92d8…16ace`, unchanged).
- **Predecessor:** TASK 12.2 (base shell), TASK 12.2B–E ([AS_POS_READ_ONLY_SHELL.md](AS_POS_READ_ONLY_SHELL.md),
  the POS workspace and shared chrome). TASK 12.2F ports the pieces that
  run *before* that shell exists: the splash, the mandatory sign-in gate,
  and a visual-only preview of V1's first-run activation wizard.
- **TASK 12.2F.1** replaced the logo asset with the approved canonical
  file supplied directly by the user (`Desktop\LOGO\LOGO AS ONE POS
  2207.png`, inspected and confirmed before use — not V1's own embedded
  copy) at `apps/one/assets/branding/as_logo_mark.png`, extended it to
  every screen/size the canonical HTML uses it at (see "Implemented
  components"), and generated the app's first-ever favicon/PWA icon set
  from the same source. No functional scope changed.
- **TASK 12.2G** — a final typography/logo/motion/performance pass:
  - Re-verified the logo asset byte-for-byte against the Desktop source
    (SHA-256 `ba5ea960…10491` on both) — the earlier copy had been
    re-encoded by an image library and no longer matched exactly; it is
    now a true binary copy. Extended the asset's use to the POS shell's
    sidebar (`_Sidebar`) and topbar (`_TopbarBrandMark`) brand marks,
    which had been hand-drawn gradient boxes since TASK 12.2E.
  - Extracted V1's own bundled Questrial font (`AS POS V1.html` line 10,
    a base64 TrueType `@font-face`) into `assets/fonts/Questrial-Regular.ttf`
    and wired it into `pubspec.yaml`. Applied it app-wide via `AsTheme`
    (previously macOS-system-Typography-only) in addition to the POS
    shell's pre-existing `PosTheme` reference, which had asked for
    `'Questrial'` since TASK 12.1 with no font file behind it — a
    silent, undetectable fallback until this task. Centralized the type
    scale into `design_system/tokens/as_typography.dart` (`AsTypography`),
    each constant cited against its literal V1 CSS rule, and migrated the
    startup flow's ad hoc `TextStyle(fontSize: …)` literals to reference it.
  - Added the HTML's own literal transition/animation values as named
    `AsMotion` durations (`sidebarWidth` 180ms, `accordion` 200ms,
    `tabFade` 150ms, `modalEntrance` 250ms — each cited to its CSS rule)
    and an `AsMotion.resolve()` helper that collapses any of them to zero
    under `MediaQuery.disableAnimations`. Added: a card entrance
    (`StartupCardEntrance`, V1's `slideUp`) to the login and wizard cards;
    a tab-switch fade (V1's `pgFade`) via `AnimatedSwitcher`; hover/press
    scale (`_InteractiveScale`) on the AI badge and close button matching
    V1's own `:hover`/`:active` transforms; an animated sidebar width
    (`AnimatedContainer`) and accordion open/close (`AnimatedSize`)
    matching V1's `.sidebar`/`.sb-group-body` transitions.
  - Fixed real overflow regressions the real Questrial font and the new
    sidebar animations surfaced in previously-untested code paths (see
    `pos_shell.dart`'s `_SidebarItem`/`_SidebarGroupHeader`/dark-mode-row):
    replaced fixed-size `SizedBox`/`Transform.scale` icon and switch boxes
    with `ConstrainedBox`/`Flexible`+`FittedBox` combinations that degrade
    gracefully instead of overflowing during transient/animated frames.
  - Performance: found and fixed one concrete, code-grounded issue —
    `ApiAuthGateway.hydrate()` awaited 5 independent GET requests one at a
    time on every login and every cold-start session restore; none
    depends on another's response, so they now run concurrently via
    `Future.wait`. See the TASK 12.2G report for the full
    diagnosis-and-ruled-out list (timers, image decode, animation
    controllers, debug-vs-release).

TASK 12.2F implemented two canonical states pixel-for-pixel and a third,
explicitly-gated preview:

1. **Splash** (`BootstrapScreen`) — V1's `#pos-splash` deep-blue radial
   gradient, the real "AS+" mark (the canonical approved logo asset — see
   TASK 12.2F.1 below — not redrawn as text), and a letter-spaced "PUNTO
   DE VENTA" label, with a light fade/scale entrance.
2. **Sign-in gate** (`LoginFoundationScreen`) — V1's
   `#modal-login.gate-activo`: the same background, a centered card,
   "Iniciar sesión" header with a gate-aware close button, AS+ branding,
   the Contraseña/PIN/QR tab bar, and the gradient "Entrar" button. Only
   Contraseña drives the real `AuthController.login()` — see "Functional
   vs. visual-only controls" below.
3. **First-run wizard preview** (`FirstRunWizardPreviewScreen`) — a
   visual-only port of V1's `#aspos-wizard`, reachable only from an
   explicit, non-production-gated link on the login screen. There is no
   activation/licensing contract anywhere in this backend (confirmed by
   inspection before writing any code — see "Read-only limitations"), so
   this screen never submits, persists, or bypasses anything real.

This document describes what was implemented, not what is planned.

## Implemented components

- `apps/one/lib/features/authentication/startup_visuals.dart` — shared
  chrome reused by all three states: `StartupBackground` (V1's exact
  `radial-gradient(ellipse at 50% 45%, #003efd 0%, #0027a0 45%, #000444
  100%)`), `StartupLogoMark` (the real asset, see below),
  `StartupAiBadge` (V1's bottom-left `.ai-fab`, inert), `StartupToast`
  (a custom bottom-center pill matching V1's `#toast-el`, not Material's
  `SnackBar`), `StartupTabBar`/`StartupField`/`StartupPasswordField`/
  `StartupPrimaryButton`/`StartupPinDots`/`StartupPinKeypad`/
  `StartupQrFrame`/`StartupCloseButton` — each a direct port of one V1 CSS
  rule (documented inline with the source selector).
- `assets/branding/as_logo_mark.png` — the canonical approved "AS+" logo
  (TASK 12.2F.1). Source of truth:
  `C:\Users\InMagic\Desktop\LOGO\LOGO AS ONE POS 2207.png` — 295×296 PNG,
  RGBA with transparent corners (confirmed by inspection before copying:
  `format=PNG, mode=RGBA, size=(295,296), alpha extrema=(0,255)`). Copied
  verbatim at full resolution — no crop, stretch, recolor, or redraw —
  into this single tracked path; every screen below reuses this one file
  at different display sizes rather than keeping duplicate copies.
  (An earlier revision of this task had extracted a different, HTML-embedded
  copy of the same mark before this canonical asset was supplied; that
  copy was replaced in place, not kept alongside.) Used in:
  - **Splash** (`BootstrapScreen`) — 96px, rounded, with shadow.
  - **Login card** (`LoginFoundationScreen`) — 72px, rounded, with shadow
    (`StartupLogoMark`'s default — matches V1's own 72px/`radius:18px`/
    `box-shadow` inline style on this exact image in `#modal-login`).
  - **First-run wizard preview** (`FirstRunWizardPreviewScreen`) — 64px,
    rounded, with shadow (V1's own wizard has no logo image; added here
    per explicit instruction since this screen is a preview, not a literal
    HTML port).
  - **POS shell sidebar brand row** (`_Sidebar` in `pos_shell.dart`) —
    24px, rounded (radius 6, no shadow — matches V1's `#sb-logo-img`
    inline style exactly).
  - **POS shell topbar brand mark** (`_TopbarBrandMark` in
    `pos_shell.dart`) — 28px height, unrounded, natural aspect ratio, no
    shadow (matches V1's plain `.logo-img{height:28px;width:auto}`).
  - **Browser tab / PWA icon** — `web/favicon.png` (32px) and
    `web/icons/Icon-{192,512}.png` / `Icon-maskable-{192,512}.png`,
    resampled from the same source and wired into `web/index.html`
    (`<link rel="icon">`, `<link rel="apple-touch-icon">`) and
    `web/manifest.json`'s `icons` array — the app previously shipped with
    no favicon or PWA icon at all (`web/index.html` had carried a
    "will be added when brand assets are versioned" placeholder comment
    since TASK 12.1).
  This closes the "no bundled logo asset anywhere" gap noted in every
  TASK 12.2B–E report.
- `apps/one/lib/features/authentication/screens.dart` —
  `BootstrapScreen` and `LoginFoundationScreen` rewritten in place (their
  public names/routes are unchanged; `CompanySelectionScreen`,
  `BranchSelectionScreen`, `UnavailableScreen`, `SessionEndedScreen` are
  untouched — V1 has no multi-tenant company/branch-selection concept, so
  there is no canonical reference for those screens).
- `apps/one/lib/features/authentication/first_run_wizard_screen.dart` —
  `FirstRunWizardPreviewScreen`, entirely new.
- `apps/one/lib/app/router.dart` / `apps/one/lib/app/app.dart` — a single
  new route (`/dev/first-run-preview`) and an `AsEnvironment` threaded
  from `AppConfig` down to `PlatformScope`, used only to gate the
  preview's visibility and its one redirect exception.

## Functional vs. visual-only controls

Fully functional, unchanged: the Contraseña tab's identifier/password
fields and submit → real `AuthController.login()` → real
`POST /api/v1/auth/login`.

Visually faithful but inert (each shows a notice instead of performing an
action, matching the "don't hide unsupported controls" rule established
in TASK 12.2C):

- **PIN tab** — the 4-dot indicator and on-screen keypad are real local
  widget state (digits visibly fill in), but "Entrar"/the keypad's check
  key always surfaces a deferred notice. There is no PIN-authentication
  endpoint.
- **QR tab** — the scan frame and manual-code field always surface a
  deferred notice. There is no QR-authentication endpoint.
- **Close button (✕)** — matches V1's own `cerrarModalLoginSiPosible()`
  exactly: since this app's `/login` route is *always* the mandatory gate
  (there is no dismissible, non-gated login route in this architecture,
  unlike V1 which reuses the same modal for optional session switches),
  the close button always shows "Debes iniciar sesión para continuar" and
  never dismisses. This is a literal behavior port, not a simplification.
- **"¿No tienes cuenta?" link** — matches V1's `avisoSinCuenta()` exactly:
  in V1 this was *never* a real self-service flow either, just an
  informational toast.
- **"Cerrar sesión" link** — kept for visual fidelity (V1 always renders
  it in this modal), but honestly wired to an informational notice rather
  than `AuthController.logout()`: this screen only renders while
  unauthenticated, so there is no session to close.
- **First-run wizard's every field and "Comenzar"** — entirely local,
  ephemeral `TextEditingController` state; nothing is persisted or sent.
  "Comenzar" always shows that activation submission is deferred.
- **AI badge** — same deferred notice as the POS shell's topbar AI button
  (TASK 12.2E); no chat surface exists.

## Architecture boundaries

- No new `AuthPhase` was added. The first-run wizard preview is **not**
  part of the real auth state machine — it is a plain `GoRoute`
  (`/dev/first-run-preview`) reachable only via an explicit link, gated by
  `AsEnvironment != production`, with a single redirect exception in
  `router.dart` that bypasses the forced-login guard for that one path
  prefix. It never grants access to `/dashboard` or any authenticated
  route, and production builds cannot reach it even via a direct deep
  link (see `router_test.dart`'s "production deep link…redirects to
  login" test).
- No activation/licensing data model, endpoint, or validation was
  invented anywhere in `apps/api` or `packages/database`.
- The real browser auth flow (HttpOnly refresh cookie, CSRF, in-memory
  access token) is completely unchanged; only its screen was re-skinned.
- Dark mode: this screen renders in its light-mode-only V1 palette. The
  pre-authenticated screens have never had a dark-mode toggle wired to
  them (the app's `MaterialApp.router` only ever applies `AsTheme.light()`
  — dark mode today exists solely as the POS shell's own internal
  `PosTheme`, TASK 12.2E). Adding a first pre-auth dark mode was judged
  out of this task's scope and is not fabricated here.

## Read-only limitations (deliberate, not oversights)

- **There is no activation/license contract in this backend.** Confirmed
  by inspection before writing any code: no `activation`/`license` table
  or field in any `packages/database/src/schema/*.ts` file, no
  `/activation` or `/license` route in `apps/api/src/modules/`. The
  closest concept, `companies.status` (`active`/`suspended`/`closed`), is
  an operational flag with no keys, codes, or plans attached — it is not
  an activation contract. The first-run wizard therefore remains a
  disconnected, ephemeral-state preview until a real contract exists.
- **PIN and QR authentication have no backend contract.** V1's own
  implementation of both is an insecure plain-text local comparison
  against an in-browser `DB.usuarios` array — the task explicitly
  forbids porting that. Both tabs are visual-only until a real endpoint
  exists.
- **The dev-preview link's only guard is `AsEnvironment`.** It is not a
  permission check (there is no session yet at this point in the app) —
  it is a build-time/environment gate, matching how the rest of this app
  distinguishes local/test/staging/demo from production.

## Test coverage

- `apps/one/test/startup_screens_test.dart` (new) — login card branding,
  tab switching, the gate-close/admin-access/close-session inert
  notices, the AI badge, the real Contraseña submission path, dev-preview
  link visibility per environment, and the wizard preview's fields +
  deferred "Comenzar" + back-to-login navigation.
- `apps/one/test/router_test.dart` — added: a production deep link to
  `/dev/first-run-preview` redirects to `/login`.
- `apps/one/test/app_test.dart`, `apps/one/test/auth_screens_test.dart` —
  updated copy/keys (`'Bienvenido'` → `'Iniciar sesión'`,
  `'Continuar'` → `'Entrar'`) to match the new screen; no behavioral
  changes to the tests' assertions about the real auth flow itself.
