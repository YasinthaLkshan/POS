# AgriPOS implementation progress

Updated 2026-11-12.

## Current architecture

- Electron/React Windows desktop that starts its Express API locally.
- Neon PostgreSQL holds business records, staff usernames and salted scrypt password hashes, and hashed opaque API sessions.
- Each desktop stores its own product images and shop logo in local app data. Images do not sync between computers.
- SQLite stores encrypted offline sales, stock grants, a durable sync queue, and uncertain checkout recovery data.
- Historical `supabase/migrations` and old Firebase/image columns remain for migration checksum and data preservation; the current runtime uses neither Supabase nor Firebase.

## Implemented workflows

Catalog, stock receiving, FEFO inventory, sales, refunds, credit, cash registers, supplier accounts, reports and exports, staff permissions, offline cash sales, synchronization, receipts and printing are implemented. See [USER_GUIDE.md](USER_GUIDE.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Verification

Version 0.5.0 restores single-app operation. The desktop accepts a Neon PostgreSQL URL, applies migrations, creates the initial administrator on an empty database, and starts the Express API itself. TypeScript and 53 unit/integration tests passed; installer and packaged-app verification are in progress. The older 0.4.1 installer still needs a separately running API.

Build output: `apps/desktop/release/AgriPOS Setup 0.5.0.exe`.

## Live setup still required

The local `.env` has **no Neon connection string**. No live Neon migration or first-shop provisioning has run. Follow [SETUP.md](SETUP.md), then test on a staging shop with a real account, multiple desktop image behavior, offline restart/sync, a physical printer and database/desktop backup restoration. The installer is unsigned.

An earlier Firebase SQL Connect/Cloud SQL trial may still exist. Code changes do not cancel that cloud resource.
