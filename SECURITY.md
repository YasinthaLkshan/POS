# Security

## Credentials and authentication

The renderer receives no access-token API or database credentials. Electron main encrypts API session values using Windows secure storage. Remote API connections require HTTPS; HTTP is allowed only to `localhost` or `127.0.0.1` on the same computer. There is no public shop signup.

The API stores salted scrypt password hashes and SHA-256 hashes of random session tokens in Neon. It resolves active staff membership from PostgreSQL on every request. Password changes revoke all sessions for that account. Client-supplied role/shop claims are not trusted. Sensitive writes require the permission matrix in `packages/shared/src/permissions.ts`.

| Role          | Scope                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Administrator | Full business and configuration access                                                          |
| Manager       | Daily operations, pricing, refunds and reports; no staff/settings administration                |
| Cashier       | Catalog, sales, customers and repayments; no cost/profit/discount/refund access                 |
| Inventory     | Catalog metadata, cost, inventory and purchasing; no selling-price changes or financial reports |

## Database access

Business tables have RLS enabled and no direct `anon`/`authenticated` grants. The trusted backend is responsible for tenant predicates and service authorization. For deployment, create an isolated backend database credential with only the required application-schema access; it must be able to perform trusted operations despite RLS (for example a dedicated controlled backend role configured by the database administrator). Do not distribute the owner, migration or backend credential to desktops.

The migration credential creates business tables, image storage, and triggers. Keep it separate from the runtime credential where the chosen Neon plan permits. A database owner connection is convenient for initial development but is not a least-privilege production setup.

### Shop network database

In the main-computer setup every till holds the `agripos` database credential, encrypted with Windows secure storage, because each till runs its own embedded API. `scripts/setup-shop-server.ps1` uses a dedicated non-superuser `agripos` role, accepts only `scram-sha-256` password logins from the detected shop subnet in `pg_hba.conf`, and opens the port in Windows Firewall only for that subnet on Private/Domain networks. Use a strong unique password, keep guest Wi-Fi on a separate network from the tills, and do not forward the PostgreSQL port on the router. Traffic on the shop network is not encrypted unless you configure PostgreSQL TLS. Backup processes receive passwords through environment variables, never command-line arguments. The Neon backup credential is stored only on the main computer.

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

Cashier-provided offline receipt totals are recomputed against the trusted grant snapshot. Uploaded grants are bound to staff/shop/terminal and batch allowances. Expired/off-policy receipts are retained as conflicts instead of accepted.

## Operational security

Keep `.env`, tokens, connection strings and initial password hashes out of source control and desktop artifacts. The Neon URL belongs only on the backend. No database credentials belong in public `AGRIPOS_` values.

Each desktop stores bounded PNG images locally under its `userData` directory. The API validates permission before recording an image marker in Neon. Image files require separate desktop backups; they are not included in Neon exports. Direct database access stays on the backend.

The API uses Helmet, bounded JSON, request IDs and rate limits. Do not log authorization headers or offline grant tokens. Place the backend behind a properly configured HTTPS proxy and restrict database networking. Review proxy/IP rate-limit behavior for the chosen host.

Unsigned development installers are not a production trust guarantee. Production releases need a signing certificate and a validated update/distribution process. Automated tests are not a penetration test; live SQL permissions and backups must be reviewed before production use.

Integration reference: [Neon connection guide](https://neon.com/docs/connect/connect-from-any-app).
