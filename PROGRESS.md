# AgriPOS implementation progress

Updated 2026-11-14.

## Current architecture

- Electron/React Windows desktop that starts its Express API locally on every till.
- The shop database is PostgreSQL on the main shop computer. Tills connect over the shop network, so internet outages do not interrupt any feature. Stock and credit checks stay consistent because all tills share one database.
- The main computer saves a backup file every 30 minutes and replaces a Neon cloud copy when online, refusing targets that hold another shop or newer activity.
- Each desktop stores its own product images and shop logo in local app data. Images do not sync between computers.
- SQLite stores encrypted offline sales, stock grants, a durable sync queue, and uncertain checkout recovery data. Offline cash checkout (walk-in cash only) is the fallback when a till cannot reach the main computer.
- Historical `supabase/migrations` and old Firebase/image columns remain for migration checksum and data preservation; the current runtime uses neither Supabase nor Firebase.

## Implemented

- [x] Factories: add, edit, search, details with drivers, balances, upcoming/overdue payments, sales history and printable report.
- [x] Lorry drivers: permanent `DRV-0001` IDs, factory, lorry, phone, notes, active status, duplicate-name confirmation, search by name/ID/lorry/phone/factory, profile with totals derived from transactions, dues by month, installments, invoices, payments and printable statement.
- [x] Normal customer credit without a permanent profile: a separate credit record per checkout (or an explicitly chosen existing record), custom repayment date, notes.
- [x] Products with sizes: loose kg (decimal quantities) and 25/50 kg bags (whole units) with independent SKU, price, cost, stock and reorder level; explicit bag-to-loose conversion; stock receipt without a purchase order; per-product stock history with before/after balances.
- [x] POS: Walk-in / Lorry driver / Credit customer, driver search, variant chips, automatic per-variant driver discounts, approved line and bill discounts, cash now with credit for the rest, editable two-month installment schedule, sequential invoice numbers.
- [x] Credit: per-invoice installments (calendar months, month-end safe), partial repayments with allocation preview (oldest due first or chosen installment), returns reduce the latest installments, credit due list (overdue → due today → due soon → upcoming → paid) with filters and search.
- [x] Daily business and dashboard from one accounting summary (gross/net sales, discounts, cash from sales, repayments, refunds, net cash, new credit, outstanding, due today, overdue); end-of-day print.
- [x] Reports: daily, cash/credit/mixed sales, repayments, outstanding, due today, overdue, driver credit, normal credit, factory credit, discounts, product sales, stock availability, stock movements, low stock, end-of-day summary; CSV, Excel XML, PDF and print.
- [x] Receipts: customer type, driver/factory, variants and units, driver/item/bill discounts, cash, credit, installments and status; separate payment receipts; reprints never create a sale.
- [x] Settings: driver installments and period, normal credit period, due-soon days, next invoice number, driver discounts per variant.
- [x] Migrations 014–017 are additive; existing credit invoices received one installment each with their history attached, and no existing row was modified.

## Decisions taken

- Money stays integer cents and quantities integer thousandths (exact, no floating point) instead of NUMERIC, to avoid rewriting historical rows.
- A bill discount on a driver sale needs `discount.approve` (manager/administrator); automatic driver discounts are allowed for any cashier.
- Drivers and quick credit records have no credit limit; registered customers keep their limits.
- Returned credit reduces the latest installments first.

## Verification

- TypeScript, ESLint and 86 unit/integration tests pass, including the 20 requested scenarios (`apps/api/tests/credit-workflows.test.ts`, `packages/shared/src/credit.test.ts`, `apps/desktop/electron/printing/receipt-html.test.ts`) and a migration backfill test.
- Two Electron end-to-end workflows pass: the original checkout/offline flow and factory → driver → sizes → driver credit sale → partial payment → receipts.
- Against a real PostgreSQL 18.6 server: all 17 migrations, concurrent sales from two tills, credit/repayment/return across tills, and backup/restore including the installment tables.
- `scripts/setup-shop-server.ps1` was verified in dry-run mode only.

## Live setup still required

No live Neon project or real shop network has been configured. Follow [SETUP.md](SETUP.md) on the main shop computer, connect another till over the shop network, and test with a staging shop: driver credit sales and repayments from two tills, receipts on the physical thermal printer, a backup to Neon, restoring onto a spare computer, and offline fallback while the main computer is off. The installer is unsigned.

An earlier Firebase SQL Connect/Cloud SQL trial may still exist. Code changes do not cancel that cloud resource.
