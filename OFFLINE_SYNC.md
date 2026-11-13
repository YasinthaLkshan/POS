# Offline operation and synchronization

With the recommended setup in [SETUP.md](SETUP.md), the shop database runs on the main shop computer, so an internet outage does not interrupt any feature. Offline checkout below is the fallback for a till that cannot reach the main computer at all, for example when it is switched off or the shop network is down.

## Authorization

1. An administrator authorizes the terminal in **Offline & sync**.
2. A staff member signs in online and prepares offline access with an 8–12 digit PIN. If the shop requires cash sessions, the register must be open.
3. The backend issues a 12-hour grant bound to that staff member, shop and terminal. It contains a product/price snapshot and nonexpired batch allowances, with an HMAC-derived bearer token whose hash is stored on the server.
4. Electron encrypts the grant using Windows secure storage. PIN verification uses scrypt with a random salt. Five failed attempts lock local unlocking for 15 minutes; expiration and backward clock changes also block access.

One staff authorization is prepared per terminal at a time. An existing snapshot cannot be replaced while any local receipt is pending, failed or conflicted. A pending uncertain **online** checkout must be resolved before switching offline. Preparing a snapshot does not reserve cloud stock.

## Approved offline functions

Cached product/category search, base-unit stock availability, walk-in cash checkout, local sales history and receipt printing/PDF. Offline sales cannot use customers, credit, discounts, card/transfer payments, parked carts, product edits, purchases or returns. The main process enforces these restrictions even if the renderer is manipulated.

Expired batches are excluded using Sri Lanka business dates. Local checkout calculates totals with shared integer arithmetic, allocates cached batches and writes the receipt, stock changes and queue payload in a single SQLite transaction before returning success. Repeating the same operation ID returns the existing local receipt; a changed payload is rejected.

## Queue and upload

Local states are `pending`, `syncing`, `synced`, `conflict` and `failed`. On restart, interrupted `syncing` rows become retryable. Retries use backoff, and the desktop attempts uploads every 30 seconds when an online Auth session is available. **Synchronize now** performs an explicit retry. Failures and conflicts remain visible in the synchronization screen.

The authenticated API verifies the grant, cashier/shop/terminal identity, receipt timestamp, allowed payment type, authorized prices and exact batch allocations. It persists the incoming receipt before trying to reconcile it. Stock changes, payment, invoice and command result are committed together. Grant batch allowances are also checked cumulatively, preventing replayed local snapshots from exceeding their authorized quantity budget.

The backend recognizes an already committed operation even if its synchronization acknowledgement was lost. Duplicate uploads do not decrement stock or collect payment again. Accepted cloud invoices retain the original receipt UUID and original sale time.

## Conflict policy

The server never silently changes an offline price, invents stock, discards a paid receipt or posts it twice. Insufficient cloud stock, an unavailable product, changed staff access, invalid allocations or a closed original register produce a retained conflict.

A manager reviews **Shop reconciliation**, investigates physical stock and posts a justified purchase receipt or stock adjustment if appropriate. The manager then retries the original receipt. For a closed register, an open reconciliation register can be selected explicitly. The original cashier and receipt amount remain unchanged, while the reconciliation cash movement records the acting manager.

If the original staff account is disabled, ordinary synchronization remains blocked; an administrator must investigate and restore authorized membership when appropriate. There is currently no separate irreversible “discard paid offline receipt” command. Conflicts must not be deleted manually. Both terminal and server records should be retained for investigation.

## Limits

- Grants last 12 hours and catalogs are capped at 10,000 products.
- Clock checks reduce accidental clock rollback but are not tamper-proof against an administrator who can rewrite local files or control Windows credentials.
- Multiple terminals can sell the same snapshot stock. This produces an explicit reconciliation conflict rather than silent overselling in the cloud.
- Local stock is not refreshed by successful sync. Prepare a new snapshot online after every pending receipt is accepted.
- SafeStorage protects data for the Windows account; copying the database to another machine/user is not a portable restore procedure.

The automated desktop test disconnects the API, completes a cash sale, restarts Electron, unlocks the saved authorization and synchronizes exactly one invoice. Physical outage and disaster-recovery drills on the deployment hardware remain required.
