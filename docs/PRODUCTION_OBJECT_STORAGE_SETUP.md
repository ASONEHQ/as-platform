# Production object-storage setup (MinIO/S3-compatible) — TASK 16.6A

The concrete, DigitalOcean-compatible plan for provisioning REAL object
storage behind the business-logo (TASK 14.5A) and product-image (TASK
16.6) features. Both features share exactly ONE implementation
(`apps/api/src/infrastructure/object-storage.ts`'s `S3ObjectStorage`,
composed by both `branding.storage.ts` and `product-images.storage.ts` —
see TASK 16.6A's own refactor) and exactly ONE set of environment
variables — there is no separate provisioning step per feature.

**This is a plan, not an executed deployment.** No secret value below is
real; every `<placeholder>` must be filled in by whoever actually
provisions this, using their own hosting provider's secrets manager —
never committed to git, never pasted into a chat/ticket in plaintext. See
`docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` step 3 for the same rule applied
to every other production secret.

## 0. Read this first — object storage is genuinely optional

Neither feature is required for the core POS flow (login → sale →
payment → receipt) or to boot the API. If you skip this document
entirely, the API boots normally; only the two branding routes and the
two product-image routes are absent (a real Fastify 404, not a crash —
see `docs/PRODUCTION_ENVIRONMENT.md`'s object-storage section for the
full evidence). Provision this only if the business-logo and/or
product-photo features should be live.

## 1. Choose ONE provider — do not stand up two

The code needs exactly one S3-compatible endpoint, shared by both
features (two buckets within it: `asone-branding`, `asone-product-images`
— see step 3). Two real options, ranked:

### Option A (recommended): DigitalOcean Spaces

DigitalOcean's own managed, S3-compatible object storage product. No
server to patch, back up, or run out of disk on — the lowest-ops-burden
choice on DigitalOcean specifically, and genuinely designed for exactly
this use case (public, CDN-fronted file storage). One real, open
verification item before committing to this path (see step 5): this
codebase's `ensureBucket()` step calls the S3 `PutBucketPolicy` API to
make a whole key-prefix public-read; DigitalOcean Spaces' bucket-policy
support has historically differed from AWS S3/MinIO's (Spaces' own
primary, well-documented public-read mechanism is the per-object ACL,
not a bucket policy). TASK 16.6A's code changes were made specifically
to de-risk this:

- `PutBucketPolicy` failures are now swallowed (best-effort, never
  blocks an upload) rather than fatal.
- Every uploaded object now also carries its own `ACL: 'public-read'`
  (an S3 API feature Spaces documents and supports as its own native
  mechanism) as an independent guarantee.

So Option A works whether or not Spaces' bucket-policy support turns out
to be full, partial, or absent — but you MUST run the step 5 verification
before considering this provisioned, specifically to confirm object-level
public reads actually work end-to-end.

### Option B (proven fallback): self-hosted MinIO, co-located with the API host

The EXACT topology local dev and this task's own integration tests
already exercise, byte-for-byte — zero code changes, zero new
`MINIO_ENDPOINT` value needed (leave it unset; the client keeps
connecting to `127.0.0.1`). Requires a host you control with persistent
disk (a Droplet, not DigitalOcean App Platform — App Platform's compute
is ephemeral/stateless and not a good fit for a stateful service like
MinIO): run the same `minio/minio` image `compose.yaml` already uses,
with real (not the local-dev placeholder) credentials, bound to the
API's own loopback interface exactly like `compose.yaml`'s `127.0.0.1:
${MINIO_API_PORT}:9000` mapping. Higher operational burden (you own
patching, disk sizing, and backups for it) but zero provider-compatibility
uncertainty.

**Do not run both.** Pick one; "prefer reusing one S3-compatible
provider/pattern... rather than creating unnecessary infrastructure"
means exactly this choice.

The rest of this document assumes **Option A**. For **Option B**,
skip straight to step 6 (env vars) and use your own MinIO container's
real credentials with `MINIO_ENDPOINT` left unset.

## 2. Create the Spaces access key

DigitalOcean Control Panel → **API** → **Spaces Keys** → **Generate New
Key**. This is an account/team-level credential (not tied to one
specific Space) — it authenticates the SAME way for both buckets you
create in step 3. Name it something identifiable (e.g.
`asone-prod-object-storage`). Record the **Access Key** and **Secret
Key** — the Secret Key is shown once; store it in your hosting
platform's secrets manager immediately (DigitalOcean App Platform's
encrypted env vars, or a droplet's restricted-permission `.env` file
outside git — never in a shell history, ticket, or chat).

## 3. Create two Spaces (buckets), same region

The bucket names are hardcoded in the application code — they are
infrastructure implementation detail, not tenant-specific configuration
(exactly like a hardcoded Postgres table name), so they must match
exactly:

| Space (bucket) name | Constant in code | Used by |
| --- | --- | --- |
| `asone-branding` | `BRANDING_BUCKET`, `branding.storage.ts` | Business-logo upload/delete |
| `asone-product-images` | `PRODUCT_IMAGES_BUCKET`, `product-images.storage.ts` | Product-photo upload/delete |

Create both in the SAME DigitalOcean region (e.g. `nyc3` — pick whichever
region is closest to your API's own hosting region to minimize upload
latency; the exact region choice is yours, not prescribed by the code).
Leave each Space's own "File Listing" set to its default (**Restricted**)
— that controls whether anonymous callers can LIST the bucket's
contents, unrelated to whether individual uploaded objects are
individually readable (which the app's own per-object `ACL: 'public-
read'` on each upload already handles — see step 5).

## 4. Configure CORS on both Spaces

Flutter Web's default renderer loads `Image.network(...)` bytes via a
real cross-origin `fetch`, which needs the object storage's own CORS
headers to permit it (unlike a plain `<img>` tag in every browser
mode). For each Space, Control Panel → the Space → **Settings** →
**CORS Configurations** → **Add**:

- **Origin**: your real Flutter Web origin (e.g. `https://app.asone.mx`
  — the exact value already in `CORS_ALLOWED_ORIGINS` for the API
  itself, per `docs/PRODUCTION_ENVIRONMENT.md`). Never `*` in
  production, matching this codebase's own established CORS posture.
- **Allowed Methods**: `GET` (reads only — uploads/deletes go through
  the API, authenticated, never directly from the browser to Spaces).
- **Allowed Headers**: `*` is fine for a GET-only origin (no
  credentialed request, no custom headers sent by an `<img>`/`fetch`
  read).
- **Access Control Max Age**: any reasonable value (e.g. `3600`).

## 5. Set the environment variables

On your API host's real secrets manager (never `.env` in git):

```
MINIO_ROOT_USER=<the Access Key from step 2>
MINIO_ROOT_PASSWORD=<the Secret Key from step 2>
MINIO_ENDPOINT=https://<region>.digitaloceanspaces.com
```

Notes:

- `MINIO_ENDPOINT` is the REGIONAL endpoint (e.g.
  `https://nyc3.digitaloceanspaces.com`), never a per-bucket one — the
  application constructs the full per-bucket, per-object URL itself
  (path-style: `{endpoint}/{bucket}/{key}`), which DigitalOcean Spaces'
  own S3-compatible API documents as a supported access pattern
  alongside its virtual-hosted-style URLs.
- `MINIO_API_PORT` does not need to be set for this option — it is only
  used to build the OLD `http://127.0.0.1:{port}` form, which
  `MINIO_ENDPOINT` (when present) replaces entirely. Leaving it unset
  (defaults to `9000`, silently unused here) is fine; do not spend time
  trying to encode `443` into it.
- These four variables are read directly via `process.env`
  (`objectStorageConfigFromEnv()`, `apps/api/src/infrastructure/object-
  storage.ts`) — they are intentionally outside `packages/config`'s
  Zod-validated schema, matching the `MERCADO_PAGO_ACCESS_TOKEN`
  precedent. No other env var, deploy step, or `DATABASE_URL`/
  `REDIS_URL` setting is affected by setting or omitting these.

## 6. Verify — do not consider this "done" without this step

Restart/redeploy the API with the new env vars, then:

1. **Boot sanity**: confirm the API still boots and every unrelated route
   still works (it will — see `docs/PRODUCTION_ENVIRONMENT.md`'s
   "fail-open-to-absent" guarantee; this step is about confirming a
   TYPO in the new vars doesn't somehow affect anything else, which it
   structurally cannot).
2. **Real upload, through the real UI**: as an operator with
   `company_settings.update` (logo) or `product.manage` (product photo),
   upload a real image through the app. Confirm the response's `value`/
   `image_url` is a real `https://<region>.digitaloceanspaces.com/...`
   URL, not a `127.0.0.1` one.
3. **Public readability — the specific Spaces-compatibility risk this
   plan flagged in step 1**: open that exact URL in a private/incognito
   browser window (no session, no auth). It must load the real image
   directly. If it instead returns an XML "Access Denied"-shaped error:
   the per-object `ACL: 'public-read'` (which this codebase always sets
   on every upload, unconditionally) is the mechanism to check first —
   confirm the Spaces access key has permission to set object ACLs; if
   it genuinely cannot, fall back to Option B (self-hosted MinIO),
   which this task's own integration tests already prove works.
4. **CORS, from the real app**: load the Flutter Web app for real, open
   a product's edit dialog / the branding screen, and confirm the
   already-uploaded image actually RENDERS inline in the card/logo
   preview (not just that the direct URL loads in step 3) — this is
   what actually exercises the CORS configuration from step 4, since a
   direct browser navigation to the image URL in step 3 does not.
5. **Delete round-trip**: remove the image through the UI, confirm the
   product/setting response shows it cleared, and confirm the direct
   URL from step 2 now 404s (best-effort delete — see
   `deleteObjectBestEffort`'s own doc comment for why a delete failure
   is swallowed rather than blocking the caller; a stray orphaned object
   is a low-severity cleanup issue, never a user-facing failure).

## 7. What "not configured" looks like to an operator (already implemented, verify it too)

If you decide NOT to provision this (or provisioning is still pending),
confirm the honest, non-broken degraded behavior directly:

- The branding screen and a product's edit dialog still load normally;
  no crash, no infinite spinner.
- Attempting an upload shows: *"El almacenamiento de imágenes no está
  disponible en este servidor. Contacta a soporte."* — never a fake
  "success," never a generic unhelpful error (TASK 16.6A;
  `pos_shell.dart`'s `_productImageErrorMessage` and
  `pos_branding_screen.dart`'s `_uploadErrorMessage`, both real 404
  cases now).
- Every other Productos/Catálogo capability (create, edit, duplicate,
  categoría/marca/proveedor/IVA/favorito/ícono/card-color — everything
  that does NOT touch a real photo) works completely normally; object
  storage is the one, cleanly isolated dependency, never a blocker for
  the rest of the catalog.
