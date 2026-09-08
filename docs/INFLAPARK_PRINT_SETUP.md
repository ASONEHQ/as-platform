# Receipt Printing Setup — AS POS Browser Print (Inflapark launch)

TASK 14.2 Section I. This document is a platform-level operator guide: **how
to configure browser printing for any AS POS branch station.** The mechanism
described here — a self-contained receipt document opened in a fresh browser
tab, printed via the browser's own native print dialog — is generic and
identical for every tenant on the platform. Inflapark is used throughout as
the worked example because it is the pilot customer actually going live, but
nothing below is Inflapark-specific machinery: a second park onboarded later
follows the exact same steps, with its own company/branch data instead of
Inflapark's.

Every claim below was checked directly against the real print code —
`apps/one/lib/features/pos/receipt_html.dart` (the pure HTML-string
renderer) and `apps/one/lib/features/pos/receipt_print_web.dart` (the
browser-facing `window.open`/`window.print` call) — not written from memory
or from what the feature "should" do. See also
[ADR-0012](adr/ADR-0012-sale-receipt-and-printing.md), the architecture
decision this setup is grounded in.

## 0. What the print mechanism actually is (and is not)

Reading `receipt_print_web.dart`'s `openReceiptPrintWindow`:

1. It opens a **brand-new, blank browser tab** via `window.open('', '_blank')`.
2. It writes a self-contained HTML document (built by `buildReceiptHtml` in
   `receipt_html.dart`) into that tab — never the running POS app's own DOM.
3. It calls that new tab's own `.print()` — the browser's native print
   dialog, the same one a user sees printing any web page.
4. If the browser blocks the popup, `window.open` returns `null` and the
   function returns `false` **without throwing** — the POS surfaces this
   honestly to the cashier ("El navegador bloqueó la ventana de impresión.
   Permite ventanas emergentes para imprimir.") rather than silently failing
   or retrying.

**There is no thermal-printer driver, no proprietary printer SDK, and no
direct printer communication of any kind.** Printing is entirely the
browser's own dialog, pointed at whatever printer (thermal 80mm, a
PDF-to-file "printer", a regular office printer) the operating system's
print dialog already lists. This is a deliberate architectural choice
(ADR-0012's "Printing" decision), not a gap — see that ADR for the
rejected alternatives (`window.print()` on the running Flutter canvas, a
proprietary thermal SDK).

## 1. What renders on the receipt today (verified against `receipt_html.dart`)

| Element | Rendered? | Source (verified) |
| --- | --- | --- |
| Business/company name | Yes | `receipt.business.companyName` — from the backend's `GET /sales/{id}/receipt` response, itself joined live from the `companies` table (`SalesRepository.receiptOrganization`, per ADR-0012). **Never hardcoded** — a different tenant's receipt shows that tenant's own `companies.display_name`. |
| Branch name / address line | Yes (if present) | `receipt.business.branchName` / `branchAddress['line1']`, same live join from `branches`. |
| Folio | Yes | `displaySaleFolio(sale.saleNumber)` — a short, deterministic display form of the canonical `sale_number` (the raw `SALE-<32-hex>` value is still the document `<title>` and every API reference; only the printed folio is shortened, per the code's own comment, because real 80mm QA showed the long form wrapping across lines). |
| Date/time | Yes | `sale.completedAt ?? sale.occurredAt`, formatted `DD/MM/YYYY HH:MM` local time. |
| Line items | Yes | `receipt.items` — frozen `nameSnapshot`/quantity/line total (never re-read from the live catalog, so a later product rename/reprice never changes a historical receipt). |
| Per-line discount | Yes, only when nonzero | A "Descuento" row directly under a line, shown only if that line's own `discountTotal` is a real nonzero amount — a legacy/undiscounted sale renders byte-identical to before this feature existed. |
| Subtotal / discount total / IVA / TOTAL | Yes | `sale.subtotal`, `sale.discountTotal` (only if nonzero), `sale.taxTotal`, `sale.total`. |
| Tender / change (cash) | Yes | Per payment: method label, "Monto aplicado", and for cash specifically "Efectivo recibido" / "Cambio" — read only from the persisted `payments` row's own `amount`/`metadata.tendered_amount`/`metadata.change_amount`, never recomputed client-side. |
| Cashier | Yes, if known | "Cajero: {displayName}" — only rendered when `receipt.cashier` is non-null (the code's own defensive fallback for the rare case the backend join finds nothing). |
| Customer snapshot | Yes, name only | "Cliente: {name}" — a **display name only**, threaded in by the caller from data already fetched elsewhere (never phone/email/birth date — see PII section below). Omitted entirely when no customer is attached to the sale. |
| CFDI disclaimer | Yes | Fixed footer text: "Comprobante de compra — no es un comprobante fiscal (CFDI)." This is a plain purchase receipt, never a Mexican tax invoice — `companies`/`branches` carry no fiscal-identifier (RFC) column anywhere in the schema, confirmed by ADR-0012's own inspection, so none is generated or displayed. |
| Logo | Partially — see §4 below | A single bundled app-wide image, not a per-tenant asset. |

Everything in the table above was confirmed by reading `receipt_html.dart`'s
`buildReceiptHtml` function directly (not inferred), cross-checked against
its own doc comments and ADR-0012.

### Nothing else is currently rendered

If your park's own launch checklist expects something not in the table
above (a QR code, a barcode, a tax ID, a promotional message beyond the
CFDI disclaimer, per-item tax-code breakdown beyond one combined "IVA"
line), it does not exist in the current template. Do not assume it will
appear — request it as a product change if actually needed, rather than
discovering the gap in front of a customer on opening day.

## 2. No unnecessary PII on the receipt (verified, not assumed)

Confirmed directly in `receipt_html.dart`:

- The customer line renders **only** `customerDisplayName` — a plain name
  string threaded in by the caller (`pos_shell.dart`), never read from a
  customer record with phone/email/birth date fields.
- The function's own doc comments state this is deliberate: "`null` renders
  the receipt byte-identical to before this task — never phone, email, or
  birth date" and, at the render call site itself, "a name only — never
  phone/email/birth date."
- A repo-wide search of `receipt_html.dart` and `refund_receipt_html.dart`
  for `phone`/`email`/`birth` finds no rendering path for any of them — the
  only two hits in `receipt_html.dart` are the doc comments quoted above,
  confirming the restriction rather than contradicting it.
- No raw internal token, session id, or password ever appears anywhere in
  the receipt-building code — the function only ever touches the typed
  `PosReceipt`/`PosReceiptBusiness`/`PosReceiptCashier`/`PosReceiptItem`/
  `PosReceiptPayment` fields listed in §1.

This satisfies `docs/GO_LIVE_CHECKLIST.md`'s own "No PII (phone/email) or
raw internal tokens appear on the receipt" item — confirmed here by reading
the code, not merely repeated from that checklist.

## 3. Recommended browser print settings (80mm format)

The generated HTML itself already declares the paper geometry — you are
configuring the browser to respect it, not fighting the browser's own
defaults:

- `receipt_html.dart` sets `@page { size: 80mm auto; margin: 3mm }` (the
  `paperWidthMm` parameter defaults to `80`; every call site in
  `pos_shell.dart` uses that default — no call site currently overrides it
  for Inflapark or anyone else). Content width is `paperWidthMm - 6mm` (3mm
  margin per side), so the page's own CSS already targets a true 80mm
  receipt, not a scaled-down A4/Letter page.
- **Paper size**: select your printer's real 80mm / 3" receipt roll paper
  size in the OS print dialog or printer driver (exact name varies by
  driver — e.g. "80mm x auto (Continuous)" — check your specific printer's
  driver dialog: `REQUIRED_OPERATOR_INPUT`, since this depends on the
  physical printer model Inflapark actually uses at each register, which
  this documentation-only pass does not know).
- **Margins**: set to **None** / **Minimal** in the browser print dialog.
  The page already reserves its own 3mm margin in the HTML/CSS itself
  (`@page { margin: 3mm }`); an additional browser-imposed margin on top of
  that will crop content or shrink it unnecessarily on a narrow roll.
- **Scale**: **100%** — do not use "Fit to page/width." The CSS already
  sizes the content to the exact `paperWidthMm` target; scaling the browser
  output additionally will make the printed text different from what
  looks correct on-screen only by accident (and can defeat the point of
  matching a real 80mm roll if the printer's page size is already set
  correctly).
- **Headers and footers**: **OFF.** This is the browser's own page-number/
  URL/date print header-footer feature (distinct from anything in the
  receipt HTML itself) — leaving it on prints an extra line of browser
  chrome (URL, page 1 of 1, date) above/below the ticket, wasting roll paper
  and looking unprofessional. Turn this off once per browser profile per
  station (see step-by-step below).
- **Background graphics**: **ON.** The receipt uses `border-top` dashed
  rules for section dividers (`.divider`, `.total-row`, `.change-row`) —
  some browsers treat these as "background" styling and omit them if
  background graphics printing is disabled, silently losing the visual
  section separators.
- **Color mode**: irrelevant — the receipt is already pure black-on-white
  (`html,body{background:#fff}`, `color:#000` throughout); there is no color
  ink to economize.

### Chrome / Edge popup permission (the print path opens a new tab)

`openReceiptPrintWindow` calls `window.open('', '_blank')` — every browser
that treats this as a "popup" (which both Chrome and Edge, the two
Chromium-based browsers most likely to be used at a POS station, do by
default for a script-initiated `window.open`) will block it on first use
unless the POS origin is allowed. This document covers Chrome and Edge
specifically because they are Chromium-based and share the same settings
UI; the underlying mechanism (`window.open`/`window.print`) is standard and
works in any modern browser that permits the popup, so the same idea
applies elsewhere with different menu wording.

**One-time setup per browser profile per station, done BEFORE opening day:**

1. Navigate to the AS POS URL for this branch (e.g.
   `https://app.asone.mx` — the real Flutter origin, per
   `docs/DOMAIN_AND_HTTPS_TOPOLOGY.md`) at least once.
2. Trigger a print action once (e.g. print a test/completed sale's receipt)
   so the browser shows its "Pop-up blocked" indicator for this exact
   origin.
3. **Chrome**: click the blocked-popup icon in the address bar → "Always
   allow pop-ups and redirects from `<the POS origin>`" → Done. Or:
   Settings → Privacy and security → Site settings → Pop-ups and
   redirects → Add → enter the exact POS origin under "Allowed to send
   pop-ups and use redirects."
4. **Edge**: same icon/flow in the address bar, or Settings → Cookies and
   site permissions → Pop-ups and redirects → Allow → add the exact POS
   origin.
5. Confirm by printing again: the new tab should open immediately with no
   "blocked" indicator.

Do this on every physical station (each browser profile is independent) —
a station where this was never done will show the POS's own honest
"popup blocked" error on the very first real sale of opening day if not
caught beforehand (see the opening-day checklist's pre-open test-print
item).

### Turning off browser print headers/footers (Chrome/Edge)

This is set inside the print dialog itself each time, or defaulted via the
browser's own print settings depending on version — in the print preview
dialog (opened automatically by `.print()`), expand **"More settings"** and
toggle **"Headers and footers"** off before the first real print; most
Chromium versions remember this preference for the browser profile
afterward, so it is effectively a one-time setup step per station, but
verify it stayed off during the pre-open test print each operating day
(browser updates can occasionally reset print preferences).

## 4. Logo / branding — what exists today, and what does not

Checked directly in the code (not assumed):

- `receipt_html.dart`'s `buildReceiptHtml` **does** accept a `logoDataUri`
  parameter and renders it as an `<img class="logo">` at the top of the
  receipt when non-null (confirmed: `logoHtml` construction, lines ~90-92).
- Every call site in `apps/one/lib/features/pos/pos_shell.dart` (the sale
  receipt, the reprint dialog, and both refund-receipt call sites) does
  supply a `logoDataUri` — via a shared `_receiptLogoDataUri()` helper that
  loads `assets/branding/as_logo_mark.png` from the **compiled Flutter web
  bundle** (`rootBundle.load(...)`) and base64-encodes it into a `data:`
  URI, caching the result in memory.
- **This is one single, shared image bundled into the app itself — the
  same AS ONE app mark for every tenant on the platform.** It is not
  read from any per-company/per-branch database column, settings row, or
  uploaded asset. Confirmed by inspection: nothing in
  `apps/api/src/modules/admin` or the `companies`/`branches` schema stores
  a logo/branding reference at all, and ADR-0012 itself states this
  explicitly: *"`companies` has no branding/logo column today, so
  per-company branding is explicitly deferred: a future task must add a
  company-level logo/branding configuration... before receipts can show a
  real per-tenant brand instead of the shared AS app mark."*

**Honest conclusion**: the receipt template technically supports a logo
image, but Inflapark cannot get **its own** logo on the printed receipt
today without a source-code change (swapping the bundled
`as_logo_mark.png` asset, which would then apply platform-wide to every
tenant sharing that build — not a config-only, per-tenant change) or, more
correctly, a future platform feature that lets each company upload/select
its own logo from `admin/settings`. Documenting a working "how Inflapark
configures its own logo" procedure here would be inventing a capability
that does not exist.

**POST-LAUNCH**: if Inflapark wants its own logo on the receipt instead of
the shared AS ONE mark, that is a product/engineering request for a
per-tenant branding feature (a `companies` logo column/asset-upload flow) —
track it as a backlog item, not something to configure via the launch-
config data file, since no such config key exists for it yet.

## 5. Test procedure (run once per station before opening day, and spot-check periodically)

1. **Complete a real (or disposable test) sale** through the normal POS
   flow at the station being configured.
2. On the "Venta completada" screen, tap **"Imprimir ticket."** Confirm:
   - The popup opens immediately (no "blocked" indicator — see §3 above if
     it does).
   - The physical/PDF print output matches what the print-preview dialog
     showed on screen: correct business/branch name, correct folio, correct
     date/time, every line item with correct price, correct subtotal/IVA/
     TOTAL, correct tender/change for a cash sale, cashier name if
     applicable.
   - Paper width is correct for the physical roll (no content cut off on
     either edge; no excessive blank margin).
   - No browser-injected header/footer (URL, page number, date) appears
     above or below the ticket content.
3. **Historical reprint test**: from Sales History, open that same
   completed sale again and tap the reprint action. Per ADR-0012 ("Reprint
   is just calling the same endpoint again" — `GET /sales/{id}/receipt` is
   a plain, side-effect-free read, proven by an integration test that
   calls it repeatedly and asserts the sale's version and payment count
   never change), the reprinted output must be **byte-identical** to the
   original: same folio, same totals, same items, same cashier, same
   tender/change. Compare the two printouts (or two print-preview
   screenshots) side by side to confirm.
4. Repeat steps 1-3 once per physical station (each has its own browser
   profile, popup permission, and physical printer/paper alignment) before
   relying on it for a real opening day.
5. Re-run this quick test any time the browser is updated, the station's
   printer driver changes, or after any OS-level print-settings change —
   browser/OS updates can silently reset popup permissions or print
   preferences (headers/footers, margins).

## References

- `apps/one/lib/features/pos/receipt_html.dart` — the receipt HTML
  renderer (source of every claim in §1-2, §4).
- `apps/one/lib/features/pos/receipt_print_web.dart` — the browser
  `window.open`/`window.print` mechanism (source of every claim in §0, §3).
- [ADR-0012](adr/ADR-0012-sale-receipt-and-printing.md) — the architecture
  decision record for the printing mechanism, 80mm target, and the
  logo/branding deferral.
- [docs/GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) — "Receipt / printing"
  section (this document grounds those checklist items in the actual code).
- [docs/DOMAIN_AND_HTTPS_TOPOLOGY.md](DOMAIN_AND_HTTPS_TOPOLOGY.md) — the
  real POS origin to allow through browser popup settings.
