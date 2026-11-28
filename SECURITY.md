# Security

## Credentials and authentication

The renderer receives no access-token API or database credentials. Electron main encrypts API session values using Windows secure storage. Remote API connections require HTTPS; HTTP is allowed only to `localhost` or `127.0.0.1` on the same computer. There is no public shop signup.

The API stores salted scrypt password hashes and hashes random session tokens. The desktop checks active membership against local SQLite. Password changes revoke sessions for that account. Sensitive writes require the permission matrix in `packages/shared/src/permissions.ts`.

| Role          | Scope                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Administrator | Full business and configuration access                                                          |
| Manager       | Daily operations, pricing, refunds and reports; no staff/settings administration                |
| Cashier       | Catalog, sales, customers and repayments; no cost/profit/discount/refund access                 |
| Daily sales   | Walk-in checkout, today's sales and receipts, and the employee's own active or daily cash registers |
| Inventory     | Catalog metadata, cost, inventory and purchasing; no selling-price changes or financial reports |

## Database access

Business tables have RLS enabled and no direct `anon`/`authenticated` grants. The trusted backend is responsible for tenant predicates and service authorization. For deployment, create an isolated backend database credential with only the required application-schema access; it must be able to perform trusted operations despite RLS (for example a dedicated controlled backend role configured by the database administrator). Keep standalone API credentials on the API host.

The migration credential creates business tables, image storage, and triggers. Keep it separate from the runtime credential where the chosen Neon plan permits. A database owner connection is convenient for initial development but is not a least-privilege production setup.

### Desktop database credentials

Each desktop stores its shop's Neon connection using Windows secure storage. The renderer accesses the local API through the preload bridge.

## Desktop boundary

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Preload exposes a frozen typed bridge and a fixed set of IPC channels.
- Every IPC handler checks the actual window, main frame and expected document URL.
- Schemas constrain request paths, methods and payload sizes.
- New windows, arbitrary navigation and browser permissions are denied.
- Receipts/reports escape all text and use restrictive CSPs in hidden printing windows.
- Product images are restricted PNG thumbnails fetched through the authenticated API.

## Accounting integrity

Financial and stock operations use transactions, tenant-scoped foreign keys, immutable history and idempotency fingerprints. External payment references document payments confirmed outside this application; they do not prove settlement with a payment provider. Only authorized staff can approve discounts, refunds or credit-limit changes.

For legacy receipt uploads, cashier-provided totals are recomputed against the trusted grant snapshot. Uploaded grants are bound to staff/shop/terminal and batch allowances. Expired/off-policy receipts are retained as conflicts instead of accepted.

## Operational security

Keep connection strings and passwords out of source control, desktop artifacts and public renderer settings.

The API checks image permissions. The desktop stores new shop images in SQLite and synchronizes them to Neon.

The API uses Helmet, bounded JSON, request IDs and rate limits. Do not log authorization headers or offline grant tokens. Place the backend behind a properly configured HTTPS proxy and restrict database networking. Review proxy/IP rate-limit behavior for the chosen host.

Unsigned development installers are not a production trust guarantee. Production releases need a signing certificate and a validated update/distribution process. Automated tests are not a penetration test; live SQL permissions and backups must be reviewed before production use.

Integration reference: [Neon connection guide](https://neon.com/docs/connect/connect-from-any-app).
