# Database

Migrations are ordered SQL files in `supabase/migrations`. The migration runner uses a PostgreSQL advisory lock, a single transaction and SHA-256 checksums. Never edit an already applied migration; add a new one.

| Tables                                              | Purpose and relationships                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `shops`, `staff`, `auth_sessions`                   | Tenant configuration, usernames, salted password hashes and hashed opaque sessions. Roles are server controlled. |
| `categories`, `products`                            | Unique shop SKU/barcode, base stock unit, purchase conversion, prices, tax, attributes and private image path.   |
| `suppliers`, `customers`                            | Shop-scoped contacts and customer credit limits.                                                                 |
| `purchases`, `purchase_lines`                       | Orders and received quantities. Ordering does not add stock.                                                     |
| `batches`                                           | Product stock, expiry, cost, purchase/supplier provenance and manufacturing details.                             |
| `inventory_movements`, `stocktakes`                 | Immutable stock deltas and count references.                                                                     |
| `sales`, `sale_lines`, `sale_allocations`           | Immutable invoice snapshots and exact batch consumption.                                                         |
| `payments`                                          | Confirmed cash/card/transfer allocations; external references are required.                                      |
| `customer_ledger`, `repayment_allocations`          | Signed customer balance entries; repayments allocated oldest due invoice first.                                  |
| `returns`, `return_lines`, `return_allocations`     | Partial quantities, exact original batch allocation, credit reduction, refund method and value.                  |
| `supplier_ledger`, `supplier_returns`               | Received liabilities, payments and returns; negative balances represent supplier credit.                         |
| `expenses`                                          | Recorded business expenses. Cash expenses also affect a register when supplied/required.                         |
| `cash_sessions`, `cash_movements`                   | Opening float, immutable cash activity, counted close and difference. One open session per shop/terminal.        |
| `parked_sales`                                      | Saved carts, claim ownership and completed/cancelled states. No stock reservation.                               |
| `terminals`, `offline_grants`, `sync_operations`    | Approved devices, expiring authorization snapshots and durable synchronization outcomes.                         |
| `notifications`                                     | Per-staff daily alerts and read state; source keys prevent duplicate alerts.                                     |
| `audit_logs`, `operations`                          | Administrative history and command idempotency results.                                                          |
| `financial_events` view                             | Sales and negative return events on their respective business dates.                                             |
| `factories`                                         | Groups lorry drivers. Drivers are `customers` rows with `kind='driver'`, `factory_id`, `driver_code` and lorry.  |
| `customers.kind`                                    | `registered`, `driver` or `walk_in` (quick credit record created at checkout). Null `credit_limit` = no limit.   |
| `product_families`, `products.family_id`            | A product sold in sizes; each size is a product row with its own SKU, price and stock batches.                   |
| `driver_discounts`                                  | Per-unit discount per variant, applied automatically only to driver sales and snapshotted on `sale_lines`.       |
| `stock_conversions`                                 | Explicit bag-to-loose conversions with matching `conversion_out`/`conversion_in` movements.                      |
| `credit_installments`                               | Each credit invoice's own schedule (sequence, due date, amount).                                                 |
| `installment_allocations`, `installment_reductions` | Repayment and returned-credit parts per installment. `installment_balances` view derives paid and remaining.     |

## Invariants

- Money is integer cents and quantities are integer thousandths. No floating-point stock writes.
- Composite `(shop_id, id)` foreign keys prevent cross-shop product/contact references.
- Quantities cannot become negative; received quantities cannot exceed ordered quantities.
- A sale is accepted only when stock and payment/credit rules pass in the same transaction.
- Customer balance is the sum of signed immutable ledger entries. Invoice debt subtracts repayment allocations and returned credit.
- A return reduces unpaid credit on its invoice first. Only the paid portion produces a refund. Cumulative apportionment preserves rounding cents across partial returns.
- Sellable returns restore original batches. Unsellable returns restore no stock and retain their original cost in financial reports.
- Supplier returns require original purchase provenance and cannot exceed available or originally received stock.
- Ledger, movement, return and audit history is protected by immutable-history triggers. Corrections require new compensating operations.
- Installment balances = amount − allocated repayments − returned credit. Their sum always equals the customer ledger balance; repayments are refused if they disagree.
- Repayments go to the oldest due installment first unless installments are chosen explicitly; returned credit reduces the latest installments first.
- Migration 016 gave every existing credit invoice one installment on its original due date and attached its historical repayments and returns, without modifying existing rows.
- Invoice numbers are sequential per shop (`PREFIX-000001`) and assigned inside the shop-locked checkout transaction; offline receipts keep their UUID-based numbers.

## Reporting dates

Business dates use `Asia/Colombo`. Sales appear on sale dates and returns on return dates. Current stock and balance reports are current-state snapshots, regardless of the date controls. Historical valuations are not reconstructed from the current stock report.

## RLS and grants

Every application table has RLS enabled. `PUBLIC`, `anon` and `authenticated` receive no direct business-table grants. The trusted backend uses a separately controlled database role with access; see [SECURITY.md](SECURITY.md). The financial-events view is also revoked from direct clients. Migration 013 adds local account credentials and sessions. Historical Firebase UID and image-byte columns remain for data preservation but are unused. New image bytes are saved only in each desktop's app data.

## Local SQLite

`checkout.sqlite` retains encrypted online submissions and outcomes. `offline.sqlite` stores an encrypted catalog grant, encrypted receipts and queue payloads, a salted scrypt PIN verifier, lockout state, local batch quantities and event history. SQLite uses WAL and `synchronous=FULL`. Windows secure storage encrypts sensitive payloads; the whole SQLite file is not transparently encrypted. Back up consistently using the procedures in [DEPLOYMENT.md](DEPLOYMENT.md).
