# AS ONE — Domain and HTTPS Topology (TASK 14.1 §K)

Intended production domain topology, grounded in what the CORS/cookie/proxy
code in `apps/api` actually supports today — not a green-field design. See
[PRODUCTION_GAPS.md §2-4](PRODUCTION_GAPS.md) for the underlying audit this
document builds on, and
[DEPLOYMENT_PACKAGING.md](DEPLOYMENT_PACKAGING.md) for how the two halves of
the platform are built and shipped.

---

## 1. What the code actually implements today

Three pieces of `apps/api` code govern this topic, all read in full for this
document:

- **CORS** — `apps/api/src/plugins/security.ts:39-69` registers
  `@fastify/cors` with `credentials: true` and an `origin()` callback that
  allows only origins present in `config.corsAllowedOrigins`. There is no
  `origin: true`/`'*'` path. `corsOriginsSchema`
  (`packages/config/src/index.ts:7-24`) explicitly rejects `'*'` and any
  non-parseable URL, de-duplicates, and freezes the list; it defaults to
  `http://localhost:3000,http://127.0.0.1:3000` when `CORS_ALLOWED_ORIGINS`
  is unset.
- **Origin re-check on auth endpoints** — `requireApprovedOrigin`
  (`apps/api/src/modules/auth/auth.routes.ts:61-69`) independently checks
  `request.headers.origin` against the same `config.corsAllowedOrigins` list
  for every browser-transport auth endpoint (login-as-browser,
  browser-bootstrap, refresh, logout, logout-all, company/branch switches).
  CORS policy and this app-level check are sourced from the exact same
  validated config value.
- **The refresh cookie** — `setRefreshCookie`/`clearRefreshCookie`
  (`apps/api/src/modules/auth/auth.routes.ts:20-59`) issue
  `HttpOnly; SameSite=Strict; Path=/` unconditionally, `Secure` only when
  `config.nodeEnv === 'production'`, and name the cookie `__Host-asone_refresh`
  in production vs. `asone_refresh_local` otherwise.

## 2. Same-origin vs. separate-origin — evaluated against this code, not in the abstract

**The code already correctly implements separate-origin subdomains sharing one
registrable domain**, and this document recommends exactly that shape for AS
POS's launch. The reasoning, grounded in the code above:

- The `__Host-` cookie name prefix (used in production) is a browser-enforced
  contract: a `__Host-`-prefixed cookie **must not** carry a `Domain`
  attribute and is therefore host-locked to whichever host actually issued
  it (e.g. `api.asone.mx`). The code never sets `Domain` on this cookie
  (`auth.routes.ts:47-49`, `:56-57`) — it was written for a host-locked
  cookie, which is the separate-origin shape, not a shared-`Domain` cookie
  that would only make sense under one parent domain visited directly.
- `SameSite=Strict` blocks a cookie from being sent on **cross-site**
  requests, not cross-*origin* ones. Two subdomains of the same registrable
  domain (`app.asone.mx` calling `api.asone.mx`) are **same-site** by
  browser definition even though they are different origins — so
  `SameSite=Strict` does not block the refresh cookie on
  `app.asone.mx → api.asone.mx` requests. This is exactly the shape the
  cookie code above was built for.
- `apps/one/README.md:89` already documents this intended production shape in
  plain language: *"Use the same hostname label for Flutter and the local API
  (`127.0.0.1`) so `SameSite=Strict` behaves consistently. The tracked local
  example allows exactly `http://127.0.0.1:8080`; **staging and production
  must provide their own explicit origin allowlists**."* — i.e. the app
  already anticipates the Flutter origin and the API origin being two
  different values that must each be added to an allowlist, which only makes
  sense if they are two different origins in the first place.
- [DEPLOYMENT.md §Domains](DEPLOYMENT.md#domains) already commits AS ONE to a
  ten-subdomain topology under `asone.mx` (`www`, `app`, `api`, `pos`, `ceo`,
  `rewards`, `events`, `admin`, `docs`, `status`) for the platform as a
  whole — a single same-origin domain for the whole product line was never
  the plan, and nothing about AS POS specifically should invent a
  contradictory shape.

**Concrete recommendation for AS POS's launch**: `app.asone.mx` (Flutter web,
the app referenced by TASK 14.1) and `api.asone.mx` (Fastify API), both under
the registrable domain `asone.mx`. This requires **zero code changes** —
only environment configuration:

- `CORS_ALLOWED_ORIGINS=https://app.asone.mx` on the API (add any additional
  real origins, e.g. a staging subdomain, comma-separated — never `*`, which
  the schema rejects anyway).
- `AS_API_BASE_URL=https://api.asone.mx` baked into the Flutter build via
  `--dart-define` (see
  [DEPLOYMENT_PACKAGING.md §2.1](DEPLOYMENT_PACKAGING.md)) — the app's own
  `app_config.dart:28-30` refuses to build a working session with a
  non-HTTPS API URL outside `AS_ENV=local`, so this cannot silently regress
  to plaintext.
- `NODE_ENV=production` on the API, which is what actually switches the
  cookie to `Secure` + the `__Host-` name (§1 above) — not a separate flag.

**Why not a same-origin reverse proxy instead** (e.g. everything under
`app.asone.mx`, API mounted at `app.asone.mx/api`): it is a legitimate
alternative in the abstract — same-origin requests need no CORS at all — but
it is not the better choice *for this repository's actual state*: it would
require inventing new proxy path-routing configuration that does not exist
anywhere in this repo today (no `nginx.conf`, no Traefik/Caddy config, no
`infrastructure/` proxy rules were found), for a problem the existing
CORS/cookie code already solves correctly and which
[PRODUCTION_GAPS.md §2-3](PRODUCTION_GAPS.md) independently rated "not a
blocker." Recommending it here would mean building new infrastructure to
avoid using infrastructure (an explicit origin allowlist) that already works
and is already tested. The subdomain approach also degrades better under
[DEPLOYMENT_PACKAGING.md §3](DEPLOYMENT_PACKAGING.md)'s independent-artifact
principle: the Flutter static bundle and the API process can sit behind
different hosts/CDNs entirely, not just different paths on the same origin.

## 3. HTTPS termination

Nothing in `apps/api` terminates TLS. `apps/api/src/bootstrap/
create-app.ts:16-28` constructs `Fastify({...})` with no `https` option — it
passes `bodyLimit`, `keepAliveTimeout`, `requestTimeout`, `trustProxy`, and
router/logging options, never a TLS key/cert pair. Fastify therefore listens
on plain HTTP (`config.apiHost`/`config.apiPort`, both validated strings/
numbers with no default host — `packages/config/src/index.ts:68-69`).

**TLS termination is expected to happen in front of the API** — at a reverse
proxy, load balancer, or edge network — never inside the Fastify process
itself. This is consistent with, not merely compatible with, `TRUST_PROXY`
existing as a config option in the first place (§4 below): a `trustProxy`
setting is meaningless unless something really does sit between the browser
and Fastify. [DEPLOYMENT.md §Initial topology](DEPLOYMENT.md#initial-topology)
already names "NGINX or Traefik terminates internal ingress responsibilities"
as the intended shape; this document does not need to pick between NGINX,
Traefik, Caddy, or a managed cloud load balancer — any of them satisfies the
same contract (terminate TLS, forward plain HTTP, set `X-Forwarded-*`).

## 4. Secure cookies and `TRUST_PROXY` — the actual current interaction

These are **two independent settings that happen to both matter in the same
deployment**, not one setting deriving from the other — worth stating
precisely because it is easy to assume a coupling that the code does not
have:

- The cookie's `Secure` flag is driven purely by `config.nodeEnv ===
  'production'` (`auth.routes.ts:46`, `:54`). It does **not** read
  `config.trustProxy` or `request.protocol` at all. In production, the
  refresh cookie is always marked `Secure`, regardless of `TRUST_PROXY`.
- `TRUST_PROXY` (`packages/config/src/index.ts:100`, defaulting to `false`)
  only feeds `trustProxy` into the Fastify constructor
  (`create-app.ts:27`), which controls whether Fastify trusts
  `X-Forwarded-For`/`X-Forwarded-Proto` from an upstream proxy — its only
  observed consumer today is `@fastify/rate-limit`'s IP-based key generator
  (per [PRODUCTION_GAPS.md §4](PRODUCTION_GAPS.md#4-trusted-proxy--https-assumptions),
  confirmed by grep: no application code reads `request.ip`/`request.protocol`
  directly).
- A `Secure`-flagged cookie works correctly through a reverse proxy that
  speaks plain HTTP to Fastify internally, because the browser's `Secure`
  check is about the scheme **the browser itself used** (`https://
  app.asone.mx` or `https://api.asone.mx`) — not what Fastify sees on its
  own socket. So the two settings must both be configured correctly, but
  neither one silently fixes the other: a production deploy behind a real
  reverse proxy needs **both** `NODE_ENV=production` (for the cookie) **and**
  `TRUST_PROXY=true` (for rate-limiting to see real client IPs instead of the
  proxy's) set explicitly. Forgetting `TRUST_PROXY=true` does not create a
  security hole (the unsafe direction requires an explicit opt-in, confirmed
  in PRODUCTION_GAPS §4) — it only degrades rate-limit accuracy, silently.

## 5. Cloudflare — one viable edge option, not a hard requirement

`docs/DEPLOYMENT.md`, `docs/DISASTER_RECOVERY.md`, `docs/TECH_STACK.md`,
`docs/BROWSER_AUTHENTICATION_CONTEXT.md`, and `docs/adr/README.md` all mention
Cloudflare as the intended DNS/edge-TLS provider. A repo-wide grep for
`cloudflare` (excluding `node_modules`/lockfiles) confirms it appears **only
in documentation**, never in `apps/api/src`, `apps/one/lib`, or any config
file — no Cloudflare Worker, no `wrangler.toml`, no Cloudflare-specific
header parsing, no dependency on the Cloudflare API anywhere in code. TASK
14.1's own mention of `app.asone.mx` is consistent with Cloudflare fronting
that domain, but nothing in this repo hardcodes it. Document it here as what
it actually is: **one legitimate choice** for DNS + edge TLS + basic
protection in front of the reverse proxy from §3, freely swappable for any
other DNS/CDN provider without touching `apps/api` or `apps/one` code, since
neither reads or depends on anything Cloudflare-specific.

## 6. WebSocket / realtime — nothing to configure yet

`docs/REALTIME_EVENTS.md` is a **contract document**, not an implementation —
it says so of itself ("It contains no executable WebSocket, Redis, worker,
Fastify, Flutter, SQL, migration, or infrastructure configuration," §1) and
lists *"WebSocket server/provider/library and deployment integration"* as the
**first of its own 11 explicitly open decision areas** (§15.1) — i.e. even
the contract's authors have not yet chosen an implementation.

A repository-wide grep for an actual implementation confirms this is still
true in code: no match for `websocket`, `@fastify/websocket`, a bare `'ws'`
import, or `socket.io` anywhere in `apps/api/src`, and neither `ws` nor
`socket.io` nor `@fastify/websocket` appears as a dependency in
`apps/api/package.json` or `apps/worker/package.json`.

**There is therefore nothing to document a domain/TLS topology for yet.**
When a WebSocket publisher is eventually built, it will need its own
`wss://` passthrough consideration at whatever reverse proxy terminates TLS
(§3) — but inventing that topology now, for a feature with zero lines of
implementation, would misrepresent this repo's actual state. This section is
intentionally short for that reason.
