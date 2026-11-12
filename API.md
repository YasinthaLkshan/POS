# API reference

Base: `/api/v1`. Sign in with `POST /auth/login` using `{username,password}`. Send its opaque `token` as `Authorization: Bearer <token>` and use JSON content type. Successful responses are `{ "data": ... }`; failures are `{ "error": { "code", "message", "requestId" } }`. HTTP codes include 401 for authentication, 403 for authorization, 409 for business conflicts and 422 for invalid input. The API verifies current staff membership on every request.

Amounts are integer cents, quantities integer thousandths, rates basis points. Shared Zod schemas in `packages/shared/src` are authoritative request contracts. Command UUIDs must be retained and reused after uncertain responses; never retry a payment with a new ID.

| Method / path                                                             | Behavior                                                                                             |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /auth/login`, `/auth/logout`, `/auth/password`                      | Username sign-in, session revocation, current/new password change.                                   |
| `GET /auth/me`, `/permissions`, `/roles`                                  | Current staff identity/permissions; role definitions require staff management.                       |
| `GET /products?search=&page=1&limit=25`                                   | Paged catalog; costs redacted by permission.                                                         |
| `GET /products/:id`                                                       | Product lookup.                                                                                      |
| `POST /products`, `PATCH /products/:id`                                   | Create/edit/archive a product.                                                                       |
| `POST /products/import`                                                   | `{operationId,csv}`; atomic import of up to 200 new products.                                        |
| `GET/POST /products/:id/image`                                            | Local desktop image marker; POST accepts `{local:true}` and never transfers image bytes.             |
| `GET/POST /categories`                                                    | Read/create categories.                                                                              |
| `GET/POST /suppliers`, `/customers`                                       | Search/list and create contacts.                                                                     |
| `PATCH /suppliers/:id`, `/customers/:id`                                  | Edit contacts; credit-limit changes require permission.                                              |
| `GET /customers/:id/ledger`, `/suppliers/:id/ledger`                      | Immutable account history.                                                                           |
| `POST /customers/:id/payments`                                            | `{operationId,payment,terminalId?}`; invoice-allocated repayment.                                    |
| `POST /supplier-payments`                                                 | `{operationId,supplierId,payment,terminalId?}`.                                                      |
| `GET/POST /purchases`, `GET /purchases/:id`                               | Orders and line details.                                                                             |
| `POST /purchases/:id/receive`                                             | Idempotent partial receiving with batch/expiry data.                                                 |
| `GET /inventory`                                                          | Paginated batch inventory.                                                                           |
| `POST /inventory/adjustments`                                             | Idempotent stock adjustment, damage or write-off.                                                    |
| `POST /inventory/stocktakes`                                              | Expected vs counted quantities; stale counts are rejected.                                           |
| `POST /inventory/supplier-returns`                                        | Stock reduction and supplier credit.                                                                 |
| `GET/POST /sales`                                                         | Sales history and atomic checkout.                                                                   |
| `GET /sales/:id`, `/sales/:id/receipt`                                    | Invoice snapshots, payments and returns.                                                             |
| `POST /sales/:id/returns`                                                 | Optional selected lines; credit reduction and refund. Omitted lines return all remaining quantities. |
| `GET/POST /sales/park`, `POST /sales/park/:id/resume`                     | Park and claim a cart without reserving stock.                                                       |
| `GET/POST /expenses`                                                      | Expense history and recording.                                                                       |
| `GET /cash-sessions`, `POST /cash-sessions/open`                          | List/open registers.                                                                                 |
| `POST /cash-sessions/:id/close`, `/cash-sessions/movements`               | Close reconciliation or cash in/out.                                                                 |
| `GET /dashboard/summary`, `/dashboard/alerts`, `/dashboard/sales-trend`   | Live operational aggregates.                                                                         |
| `GET /reports/sales`, `/reports/profit`                                   | Date-filtered sales and estimated profit.                                                            |
| `GET /reports/detail/:kind?from=YYYY-MM-DD&to=YYYY-MM-DD`                 | Typed report columns/rows. Maximum 10,000 exported rows.                                             |
| `GET /notifications`, `POST /notifications/:id/read`                      | Per-staff alerts and read state.                                                                     |
| `GET/PATCH /settings`                                                     | Shop settings, receipt text and mandatory-register policy.                                           |
| `GET /staff`, `PATCH /staff/:id`, `POST /staff/invite`                    | Staff administration; no public registration.                                                        |
| `POST /sync/terminals`, `/sync/provision`, `/sync/push`                   | Terminal approval, offline authorization and durable receipt upload.                                 |
| `GET /sync/status`, `/sync/conflicts`, `POST /sync/conflicts/:id/resolve` | Synchronization status and manager reconciliation.                                                   |

Report kinds: `products`, `categories`, `employees`, `inventory`, `low-stock`, `expiry`, `purchases`, `expenses`, `customer-balances`, `supplier-balances`, `cash-closing`, `returns`, `movements`, `audit`. Audit access requires staff-management permission. Date ranges are at most 366 days.

## Checkout example

```json
{
  "operationId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "terminalId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "lines": [
    { "productId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "quantity": 1000, "discount": 0 }
  ],
  "payments": [{ "method": "cash", "amount": 15000 }],
  "cashTendered": 20000
}
```

This buys one base unit, allocates LKR 150.00, and tenders LKR 200.00. Prices and available stock are calculated on the server. The response includes the persisted invoice ID and change.

Sales, products, contacts, inventory, purchases, expenses and cash sessions accept `page` (starting at 1) and `limit` (1–100). History groups are navigable in the desktop; table filtering/sorting applies to the loaded group. Dashboard summaries and account history previews remain bounded. CSV/Excel downloads are generated in the renderer from authorized report data; PDF generation refetches the report in Electron main.

Additional endpoints: `PATCH /auth/me` edits only the current staff member's name; `POST /purchases/:id/status` controls order submission/approval/sending/cancellation; `POST /expenses/:id/correct` preserves and replaces a mistaken expense; `POST /sales/park/:id/release` reparks and `/cancel` cancels a claimed cart; `GET /customers/:id/account` and `/suppliers/:id/account` return statements/history; `GET/POST /settings/logo` records a local shop-logo marker. Shop settings include default tax, invoice prefix and business identifiers. Dashboard also exposes `/dashboard/stock-status`, `/dashboard/activity` and `/inventory/expiring`.

`POST /auth/login` is public and rate limited. It returns a random session token only after password verification. The desktop stores that token in Windows secure storage. All other account endpoints require authentication.
