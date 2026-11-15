# Packaging and deployment

Follow [SETUP.md](SETUP.md) for the single Neon connection and automatic local SQLite setup. A local PostgreSQL service and pg_dump/pg_restore are no longer required by the desktop.

## Windows release checks

Run npm.cmd run typecheck, npm.cmd run lint and npm.cmd test -- --configLoader native. Run the tests again with AGRIPOS_SQLITE_TEST=1 to exercise the business workflows on SQLite. Clear that variable before running npm.cmd run test:e2e, which uses an isolated PostgreSQL cloud fixture and SQLite local API. Build with npm.cmd run package:win and run npx.cmd playwright test --config playwright.packaged.config.ts.

Installer: apps/desktop/release/AgriPOS Setup 0.7.0.exe. The installer is unsigned. No database password is included in the source or installer. Save connection credentials through the app's connection form; Windows encrypts them for the current user.

## Recovery and limitations

Close AgriPOS and copy the complete Windows application data folder before restoring or moving local files. Preserve unsynchronized SQLite files and their WAL files. Do not restore an old local copy over a live shop. If both computers have changed, retain both copies and reconcile their transactions; the app deliberately pauses conflicting uploads.

Cloud synchronization is not historical backup. Keep Neon recovery/history or independent backups according to your shop policy. Test receipt printing on the actual printer. No live database changes or physical printing are part of the isolated release test suite.

The historical PostgreSQL migrations and independent API remain available for compatibility. The old server setup and pg_dump helpers are legacy administration tools, not part of desktop setup.
