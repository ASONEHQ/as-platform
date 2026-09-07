# AS ONE — Deployment Packaging (TASK 14.1 §J)

Reproducible production build process for both halves of the monorepo, read
directly from the actual build tooling that exists today (worktree
`task/12-2`), not from convention. See [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md)
for the broader production-readiness audit this document builds on, and
[ARCHITECTURE.md](ARCHITECTURE.md) for the module-boundary rules the build
respects.

---

## 1. API (`apps/api`)

### 1.1 The commands, as they actually exist today

`apps/api/package.json` already defines the full pipeline — there is **no
gap to flag here**, contrary to what a green-field audit might assume:

```json
"dev": "tsx watch src/server.ts",
"build": "tsc -p tsconfig.build.json",
"start": "node dist/server.js"
```

`tsconfig.build.json` extends `tsconfig.json` and excludes `src/**/*.test.ts`;
`tsconfig.json` sets `outDir: "dist"` / `rootDir: "src"`. `apps/api/dist/`
already contains a prior build (`app.js`, `server.js`, `server.js.map`, and
compiled `bootstrap/`, `infrastructure/`, `modules/`, `plugins/`, `routes/`,
`operations/`, `development/` trees) — direct evidence the `build` script
produces a working `dist/server.js` that `start` then runs. **Production must
run `node dist/server.js` (via `pnpm --filter @asone/api start`), never
`pnpm --filter @asone/api dev`** — `dev` runs `tsx watch`, which recompiles
on every file change, keeps the TypeScript toolchain resident in the process,
and is not the artifact anyone should run unattended in production.

### 1.2 The build must run the whole workspace graph, not `apps/api` alone

`apps/api`'s compiled output imports `@asone/config`, `@asone/database`,
`@asone/errors`, and `@asone/logger` (see its `dependencies` block) through
pnpm's workspace symlinks. Each of those packages resolves through its own
`package.json` `exports` field to **its own** `dist/` (e.g.
`packages/database/package.json`: `"default": "./dist/index.js"`), not to
source. Building `apps/api` in isolation is therefore not sufficient — its
runtime `require`/`import` graph is unsatisfied unless the workspace
dependencies were built first.

`turbo.json`'s `build` task already encodes this correctly:
`"dependsOn": ["^build"]` — turbo builds every upstream workspace package's
`build` task before the package that depends on it. The actual production
build command is therefore the root-level `pnpm build` (→ `turbo run build`),
run after `pnpm install --frozen-lockfile`, not a `pnpm --filter @asone/api
build` run in isolation. `apps/worker` has the identical shape
(`"build": "tsc -p tsconfig.build.json"`, `"start": "node dist/main.js"`) and
should be built/started the same way if the worker is deployed alongside the
API.

### 1.3 What "the artifact" actually is today — a genuine gap

Because of §1.2, the deployable unit is not a single self-contained file —
it is the **whole monorepo checkout** after `pnpm install --frozen-lockfile
&& pnpm build`: every workspace package's `dist/`, plus `node_modules` (whose
`@asone/*` entries are pnpm symlinks back into the sibling package
directories, not copies). There is no bundler step (esbuild/ncc/etc.)
anywhere in this repo that would produce a single self-contained
`apps/api` artifact, and **no `Dockerfile` exists anywhere in the repository**
(confirmed by search) — `compose.yaml` only defines local-dev dependency
containers (Postgres/Redis/MinIO/Mailpit; see §2 of
[OBSERVABILITY_AND_SUPERVISION.md](OBSERVABILITY_AND_SUPERVISION.md) for why
that file is dev-only, not production-adaptable as-is).

**This is a real packaging gap, flagged rather than filled**: today,
"deploying the API" means shipping the post-build monorepo checkout (or an
equivalent layout that preserves the pnpm workspace symlink structure) to the
target host, then running `node apps/api/dist/server.js` from the repo root
with `NODE_ENV=production` and the required environment variables set. A
future pass could add a `Dockerfile` (multi-stage: `pnpm install` + `pnpm
build`, then a slim runtime stage with `pnpm deploy` or a workspace-aware
prune) or a packaging script that produces a single deployable tarball; this
document does not invent one, per the instruction to ground this doc set in
code that actually exists.

### 1.4 Environment validation at boot (already built)

`apps/api/src/server.ts:10-18` calls `loadApiConfig()` (`packages/config`) in
a `try/catch`. On any invalid/missing environment variable, Zod's `.parse()`
throws, the process writes an error and sets `process.exitCode = 1`, and
**`app.listen()` is never reached** — see
[PRODUCTION_GAPS.md §1](PRODUCTION_GAPS.md#1-environment-validation) for the
full schema audit, and
[OBSERVABILITY_AND_SUPERVISION.md](OBSERVABILITY_AND_SUPERVISION.md) for the
operational caveat that the actual Zod error detail is currently discarded
(the log line says only "API configuration is invalid.").

### 1.5 Migrations run separately — confirmed, not auto-run at boot

`apps/api/src/server.ts`'s `startServer()` never imports anything from
`packages/database`'s migration machinery — confirmed by reading the file in
full (it imports only `buildApp`, `installShutdownHandlers`, and
`createInfrastructure`). Migrations are a standalone script:
`packages/database/package.json`'s `"db:migrate": "tsx src/scripts/
migrate.ts"`, exposed at the root as `pnpm db:migrate` →
`pnpm --filter @asone/database db:migrate`. It opens its own
`DatabaseClient`, runs Drizzle's `migrate()` against `packages/database/
drizzle`, and closes the connection. **Never auto-migrate-on-boot** — this
matches [PRODUCTION_GAPS.md §9](PRODUCTION_GAPS.md#9-migration-strategy-at-startup)
and [DEPLOYMENT.md](DEPLOYMENT.md)'s documented delivery pipeline, which places
"Run controlled backward-compatible migrations" as its own numbered step,
separate from "Deploy progressively." The correct production ordering is:

1. `pnpm install --frozen-lockfile && pnpm build` (produces every `dist/`).
2. `pnpm db:migrate` against the target `DATABASE_URL`, run once, from a
   single controlled job — never from a concurrently-booting API replica.
3. Start (or rolling-restart) the API process(es) running `node
   apps/api/dist/server.js`.

---

## 2. Flutter Web (`apps/one`)

### 2.1 The exact build invocation this repo already uses

`apps/one/README.md:28` documents the real command, and `.claude/launch.json`
mirrors it for local `flutter run`:

```powershell
flutter build web --release --dart-define=AS_ENV=local --dart-define=AS_API_BASE_URL=http://127.0.0.1:3000
```

For a production build, the two defines change value (never the flag shape):
`--dart-define=AS_ENV=production --dart-define=AS_API_BASE_URL=https://<api-host>`.
Two more optional defines exist and default safely if omitted
(`apps/one/lib/core/config/app_config.dart:11-40`):

| Define | Default if omitted | Notes |
| --- | --- | --- |
| `AS_ENV` | `local` | Must be one of `local`, `test`, `staging`, `demo`, `production` — an unrecognized value throws `StateError` at startup (fail-loud, not a silent fallback). |
| `AS_API_BASE_URL` | `http://localhost:3000` | Must be an absolute, authority-bearing URL. |
| `AS_APP_NAME` | `AS ONE` | Cosmetic only. |
| `AS_ENABLE_TELEMETRY` | `false` | Provider-neutral feature gate; no telemetry SDK is wired in yet. |

**`AS_API_BASE_URL` is the exact define name** (confirmed via
`grep -rn "AS_API_BASE_URL" apps/one/lib`, resolving to
`app_config.dart:20-21`). The code itself enforces the HTTPS requirement, not
just this document: `app_config.dart:28-30` throws `StateError('AS_API_BASE_URL
must use HTTPS outside local.')` whenever `AS_ENV != local` and the URL's
scheme isn't `https`. A production build compiled with a plaintext
`AS_API_BASE_URL` therefore fails at app startup in the browser, not silently
downgrades — this is a real code guarantee, not an operational reminder.
Compile-time defines carry no secrets by design (`README.md:45`: "secrets must
never be supplied through Dart defines") — nothing about this build step
requires a secrets manager.

### 2.2 Output directory

`flutter build web --release` writes to the Flutter-standard `build/web/`
(nothing in `apps/one/pubspec.yaml` or `apps/one/web/` overrides this). The
directory is a static asset tree: `index.html`, `flutter_bootstrap.js`,
`main.dart.js`, `canvaskit/`, `assets/`, and versioned/hashed engine files.

### 2.3 `index.html` and the base href

`apps/one/web/index.html:15` has the unmodified Flutter scaffold placeholder:
`<base href="$FLUTTER_BASE_HREF">`. `flutter build web` replaces this token
with the value of `--base-href` (default `/`). Since
[DOMAIN_AND_HTTPS_TOPOLOGY.md](DOMAIN_AND_HTTPS_TOPOLOGY.md) recommends a
dedicated subdomain (e.g. `app.asone.mx`) serving the app at its root, the
default `--base-href=/` is correct and no extra flag is needed; only a
path-mounted deployment (e.g. `asone.mx/app/`) would require
`--base-href=/app/`, and there is no evidence in this repo that path-mounting
is the intended shape.

### 2.4 Static-hosting caching

Nothing in `apps/one/web/index.html`, `apps/one/pubspec.yaml`, or the build
config sets cache headers — that is a hosting-layer decision, not a code
concern, and this repo makes no claim about it either way. The standard
Flutter-web guidance still applies and is worth stating explicitly because a
naive "cache everything under `build/web/`" policy breaks releases:

- **`index.html` and `flutter_bootstrap.js`** must be served with a short or
  no-cache policy (`Cache-Control: no-cache` or a very short `max-age`) —
  they are the entry points that reference the current build's hashed asset
  filenames; long-caching them means users keep loading a stale entry point
  that then 404s on assets that were pruned by a newer deploy.
- **Everything else under `build/web/`** (the Flutter engine, `canvaskit/`,
  `main.dart.js`, content-addressed `assets/`) is safe to cache aggressively
  (`Cache-Control: public, max-age=31536000, immutable`) because a new build
  produces new filenames/hashes for changed content — this is standard
  Flutter-web deployment practice, not something this repo's build already
  configures.

### 2.5 SPA fallback routing — a real hosting requirement

`apps/one/pubspec.yaml:36` depends on `go_router: ^17.1.0`, and
`apps/one/README.md:78-84` describes named routes for bootstrap, login,
company/branch selection, the authenticated dashboard, session-ended, and
unavailable/not-found states — this is genuine client-side routing, not a
single static page. **The static host must serve `index.html` (HTTP 200) for
any unknown path**, rather than returning a host-level 404, or a browser
refresh/deep-link on any route other than `/` breaks. This is a hosting
configuration requirement for whichever static host is eventually chosen
(e.g. an S3-compatible bucket behind a CDN, Cloudflare Pages, or an
nginx/Traefik `try_files $uri /index.html;` rule) — nothing in this repo
configures it today because no hosting choice has been made yet.

---

## 3. Artifact boundary

The API's build output (`apps/api/dist/` plus its workspace-package
dependencies' `dist/`) and the Flutter build's output (`apps/one/build/web/`)
are **two independent artifacts** with no runtime coupling — the only
connection between them is the compile-time `AS_API_BASE_URL` define baked
into the Flutter bundle at build time (§2.1). They are built by entirely
different toolchains (`tsc`/Node vs. the Flutter SDK), have independent
version numbers (`apps/api/package.json`'s `"version"` vs.
`apps/one/pubspec.yaml`'s `version: 0.1.0+1`), and should be deployed and
rolled back independently: rolling back the Flutter static bundle does not
require touching the running API process, and restarting/redeploying the API
does not require rebuilding the Flutter bundle, provided the API's `/api/v1/*`
contract stays backward compatible across the deploy — which is exactly what
[DEPLOYMENT.md](DEPLOYMENT.md)'s "Application releases remain compatible with
both sides of a rolling deployment" principle already commits to.
