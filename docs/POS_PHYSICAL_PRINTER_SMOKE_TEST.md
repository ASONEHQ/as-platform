# POS Physical Printer Smoke Test (TASK 16.7B)

This is a **manual, physical** smoke test to run once a real thermal
receipt printer (ticketera, 58mm or 80mm) is physically connected. It was
written and left ready by TASK 16.7B; it was **not executed** as part of
that task — there was no physical printer available at the time. Every
step below is something a person does with real hardware; nothing here
runs automatically.

Do this on `app.asone.mx` (production), since that is where the printer
will actually be used tomorrow. Nothing about this test requires a
deploy, a code change, or touching DigitalOcean/DNS/Mercado Pago — it only
exercises features already live in production once TASK 16.7B's own
commit on `release/as-pos-v1` has been deployed there through the normal
deployment process (this task itself did not deploy anything).

## Before you start

- A real product exists with a real price and a known tax code (e.g. the
  team's own `AGUA` / `AGUA-1` fixture used for prior verification: $50.00,
  `IVA_GENERAL`).
- You know which branch (sucursal) you're testing at (e.g. "Puerta La
  Victoria") and have a user account with:
  - `sale.create` (to sell)
  - `cash_session.open` / `cash_session.read` (to open a register session
    for a cash sale)
  - `company_settings.read` / `company_settings.update` (to configure the
    printer's paper width, under Sistema → Impresora de Tickets)

## Steps

1. **Connect the printer to Windows.** Plug in the thermal printer (USB or
   network, per its own manual).
2. **Install the driver if Windows requires one.** Most modern thermal
   printers either install automatically or ship a small Windows driver.
3. **Confirm Windows itself can print a test page.** In Windows Settings →
   Printers & Scanners, select the printer → "Print a test page" (or
   right-click → Printer properties → Print Test Page). Do not proceed
   until this succeeds — if Windows itself cannot reach the printer,
   nothing in the browser will fix that.
4. **Open `app.asone.mx`** and sign in with the test account.
5. **Select the branch** ("Puerta La Victoria" or whichever branch has the
   physical printer next to it) from the branch selector.
6. **Configure the paper width.** Go to the sidebar's "Sistema" group →
   "Impresora de Tickets" (`PosPrinterSettingsScreen`). Select the real
   width of the paper roll loaded in the printer — 58mm or 80mm — and tap
   "Guardar". This is a real, tenant/branch-scoped setting
   (`receipts.paper_width_mm`); it now applies to every ticket this
   company prints, not just this session.
7. **Tap "Imprimir ticket de prueba"** on the same screen. A new browser
   tab opens with a document clearly marked **"PRUEBA DE IMPRESIÓN — NO ES
   UNA VENTA"** at both the top and bottom. Use the browser's print dialog
   (or the on-page "🖨️ Imprimir" button) and select the physical printer.
   Check the physical output for:
   - Correct physical width (no cut-off text, no excess blank margin)
   - Legible typography (the sample line "Abcdefghijklmnopqrstuvwxyz
     0123456789 ÁÉÍÓÚ Ññ áéíóú" should be fully readable, including
     Spanish accents)
   - Logo (if the company has one configured under "Marca del Ticket")
     rendering at a reasonable size, not cut off
   - Header/footer text (if configured) rendering correctly
   - A clean physical cut (manual tear or auto-cut, whichever the printer
     supports) at the end of the document

   **This step has zero effect on sales, inventory, or cash** — confirm
   this by checking Historial de Ventas and Corte de Caja before/after:
   nothing changes.

8. **Open a cash-register session** if the printer test above looked
   correct and you're ready to test a real sale. Go to "Corte de Caja" →
   open a session for this branch (pick the real cash register, enter the
   real opening float). If you skip this and try to pay in cash, the
   "Cobrar" button will tell you exactly this is missing — it will not let
   you proceed silently.
9. **Confirm AGUA's starting stock.** Go to Inventario → Existencias,
   filter to AGUA, confirm the starting on-hand quantity at this branch
   (the team's own prior test used 10 — use whatever the real current
   number is; write it down as `N`).
10. **Go to Punto de Venta** and add 1 unit of AGUA to the ticket.
11. **Confirm the ticket footer now reads "IVA" (not "IVA incluido")** —
    this was the exact fiscal-labeling bug TASK 16.7B fixed. The total
    shown should be the product's price plus its real tax (e.g. $50.00 +
    16% = $58.00 for AGUA, unless its price or tax code has changed since).
12. **Select "Efectivo" (cash)** as the payment method, enter a cash amount
    at or above the total, and tap "Cobrar".
13. **Print the receipt** from the success dialog that appears. Check
    physically that it shows: business name, branch, folio, date/time,
    cashier, the AGUA line with its price, Subtotal, IVA, TOTAL, payment
    method "Efectivo", "Efectivo recibido", and "Cambio" (if the tendered
    amount was above the total).
14. **Verify the total/IVA are correct** against the price/tax rate you
    already know for AGUA (no guessing — check the actual configured price
    in Productos and the tax rate is 16% for `IVA_GENERAL`, 0% for
    `IVA_EXEMPT`).
15. **Verify the sale persisted.** Go to Historial de Ventas, find the sale
    you just completed, open its detail — confirm the same total, items,
    and payment are there, freshly re-fetched from the server (not just
    what was already on screen).
16. **Verify the cash register.** Go to Corte de Caja for the open session
    — confirm the cash movement for this sale appears (the sale's total,
    as a real drawer credit).
17. **Verify AGUA's inventory decreased by exactly 1** — Inventario →
    Existencias, same product/branch as step 9. It should now read `N - 1`.
18. **Verify the Kardex entry.** Inventario → Admin. Inventario →
    Movimientos, filter by AGUA's variant — confirm a `sale_consumption`
    movement for exactly `-1` appears, referencing this sale.
19. **Reprint the ticket.** From the same sale in Historial de Ventas, tap
    "Reimprimir" (or the print icon in Sale Detail). Confirm it produces
    the identical receipt content — reprinting is read-only and must never
    create a second sale, a second inventory movement, or a second cash
    entry. Re-check steps 15-18 after this — nothing should have changed.
20. **Reload the page (F5 / browser refresh) and confirm everything
    persisted**: the sale is still in Historial de Ventas with the same
    total, the cash session still shows the same movement, and AGUA's
    stock is still `N - 1` — proving none of this lived only in the
    browser's own memory.

## If something fails

- **Printer test (step 7) looks wrong physically** (cut off, wrong width,
  illegible) but the on-screen preview in the new tab looks correct at the
  configured width: this is very likely a Windows/driver/paper-width
  mismatch, not a POS software bug — double check the driver's own paper
  size setting matches what you selected in step 6.
- **"Cobrar" is blocked with "Abre la caja..."**: you skipped step 8, or
  the session was closed by someone else — open (or reopen) a cash
  session for this branch and register.
- **Total doesn't match your expectation**: re-check the product's actual
  configured price and tax code in Productos before assuming a bug — the
  formula is `total = price + (price × tax rate)`, e.g. $50 × 1.16 =
  $58.00 for a 16%-taxed product; it is intentionally NOT `price` alone
  (see `docs/LEGACY_FUNCTIONAL_PARITY.md`'s TASK 16.7B section for why).
- **Any other unexpected behavior**: do not attempt a live fix during the
  demo. Note exactly what happened (screenshot if possible) and report it
  — a real regression found here should be fixed and verified the same
  way every other bug in this project's history has been, not patched
  live in production.
