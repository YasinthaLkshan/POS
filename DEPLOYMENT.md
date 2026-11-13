# Deployment, packaging and recovery

## Account and database setup

Follow [SETUP.md](SETUP.md) in order. It covers the main shop computer's PostgreSQL, connecting tills over the shop network, the Neon cloud backup, the first administrator and local desktop images.

The backend requires `DATABASE_URL` (a Neon direct connection URL) and `OFFLINE_SIGNING_KEY`. Initial provisioning also needs `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_NAME` and `SHOP_NAME`. Use a controlled runtime SQL role with the required RLS access. All private values stay on the backend.

Apply `npm run db:migrate` once to the intended database, then use `npm run setup:admin` to provision the first administrator. For an existing shop, use the explicit administrator-linking procedure in the setup guide. Run `npm run setup:check` and staging workflows before production.

The API authenticates usernames and passwords against salted scrypt hashes and issues opaque revocable sessions. Administrators create staff accounts with initial passwords; staff change them in Settings. Maintain a secure administrator recovery procedure for forgotten passwords.

The root Dockerfile builds the API separately from the desktop. `.dockerignore` excludes credentials and local artifacts. Container deployment has not been executed against a live Neon database in this workspace.

## Desktop connection

Use **Connect your shop** to choose whether the computer is the main shop computer or a till, and to enter the shop database URL (plus the Neon backup URL on the main computer). The installed app stores them using Windows secure storage, creates the database on the main computer if needed, applies migrations, and starts its local API automatically. The installed app does not read the source repository `.env`.

## Windows build

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --configLoader native
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run native:check -w @agripos/desktop
npm.cmd run package:win
npx.cmd playwright test --config playwright.packaged.config.ts
```

Output: `apps/desktop/release/AgriPOS Setup 0.6.0.exe`; unpacked executable: `apps/desktop/release/win-unpacked/AgriPOS.exe`.

If Electron's distribution download times out after the desktop build succeeds, package using the locked runtime already installed by `npm ci`: `npm.cmd run package:win -w @agripos/desktop -- --config.electronDist=../../node_modules/electron/dist`. This does not rebuild the renderer; run `build:desktop` first after any source change.

better-sqlite3 13 uses a Node-API prebuilt binary. The package config unpacks it from ASAR and disables the incompatible automatic node-gyp rebuild path. Validate the binary with `native:check` and the packaged smoke test for every supported target; do not assume an x64 build works on another architecture.

`ELECTRON_RUN_AS_NODE` must not be inherited by a normal app launch. The development and test launchers remove it. Do not disable Electron sandboxing for a release.

Configure electron-builder's supported Windows signing environment in your secure build pipeline before public distribution. No certificate is present here. The current installer uses a per-user NSIS flow with a selectable installation directory. Automated updates are not implemented; release upgrades are distributed as installers.

## Printing and scanners

Install the Windows printer driver. Select a printer and paper format (58 mm, 80 mm or A4) in Settings. Test long receipts, margins, Unicode text, paper cutting if provided by the driver, cancellation, reprinting and PDF saving on actual hardware. The application does not directly issue cash-drawer or fiscal-printer commands. Keyboard-wedge barcode scanners should send Enter after the scanned code.

## Backups

- Shop database: the main computer writes a `pg_dump` custom-format file every 30 minutes (and on **Back up now**) to `userData\backups`, keeping the newest 48, and then replaces the Neon copy in one `pg_restore` transaction. Copy some of these files to removable or off-site storage according to shop policy, and configure Neon's own history retention as a second layer.
- Restoring the shop database: install PostgreSQL on the replacement computer, run `scripts\setup-shop-server.ps1`, then restore the newest backup file (or the Neon copy) into the empty `agripos` database, for example `pg_restore --no-owner --no-privileges --single-transaction -h localhost -U agripos -d agripos agripos-YYYYMMDD-HHMMSS.dump`. To start from Neon, first create a file with `pg_dump --format=custom "<Neon URL>" -f neon.dump`. Then choose **Connect your shop > The main shop computer** with the same URL; existing administrators are kept. Test this procedure on a spare computer before you rely on it.
- Desktop: first synchronize and reconcile all receipts. Quit AgriPOS completely, then back up its entire Electron `userData` directory, including SQLite files, local product/shop images, terminal ID and encrypted session/configuration files. Do not copy only a live SQLite main file while its WAL is active.
- SafeStorage ciphertext is tied to the Windows account. A local backup is not a portable plaintext archive. Preserve the original account/machine recovery capability until every paid offline receipt is reconciled.
- Restore only while the application is stopped. Keep the original directory intact. Restoring an older snapshot can replay pending receipts; server operation IDs prevent duplicate posting, but the local authorization should be renewed online before further selling.

Never delete pending/conflicted queues to “fix sync.” Preserve both the local profile and server `sync_operations` for investigation.

## Release acceptance

Use a staging shop and record evidence for clean installation, first login, upgrade preserving the profile, SQLite load, offline restart, lost acknowledgement recovery, export dialogs, physical printing and role restrictions. The packaged-executable smoke test verifies launch/isolation/SQLite, not the full installer UI or production infrastructure. Consult PROGRESS.md for which checks actually ran.
