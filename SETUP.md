# AgriPOS setup

1. Install AgriPOS Setup 0.7.0.exe on Windows.
2. Open **Connect your shop** and paste your **Neon cloud database URL**. The URL is encrypted using Windows secure storage on this computer; it is never included in the installer.
3. For an existing shop, keep the existing username and password. For a new empty database, enter a shop name and an initial admin password of 12–256 characters, then sign in as admin.
4. Connect to the internet for the first download. After that, the same login, screens and role permissions work offline.

There is no PostgreSQL installation, main-computer role, second database URL, terminal authorization or offline PIN. SQLite is created automatically in the application's Windows user data folder.

## Changing computers

Use **Cloud sync > Sync now** before leaving one computer. Wait for synchronization to finish, then open the other computer online and synchronize before working. Installations share the same Neon shop and accounts, but each keeps its own SQLite copy. Enter the URL once on each installation because Windows encryption is tied to that Windows account.

This version supports one active POS workflow. If both computers make changes before synchronizing, synchronization pauses and keeps both copies instead of choosing which records to overwrite. Do not erase either local database; reconcile the two copies before resuming cloud uploads.

## Offline work

All business operations run against SQLite, including products, stock, sales, credit, repayments, returns, reports and staff permissions. Authentication uses the same password hashes and roles. Changes to another computer's password or role become available here on the next successful synchronization. Cloud sync retries every 30 seconds; unsynchronized data survives closing and restarting the application.

Product images and the shop logo are stored in SQLite and synchronized to Neon. Images from older versions that exist only on disk should be uploaded again to include them in cloud sync.

## Upgrading from 0.6

Synchronize any receipts in the old offline PIN mode using 0.6 before upgrading. Keep a copy of the original application data folder. The old offline receipt files are retained; they are not imported as full shop data. If your previous main database was local PostgreSQL, migrate that shop to Neon before pointing this version at it. Existing Neon shop data and accounts are preserved.

## Build

Use Node 24 and run npm.cmd ci --ignore-scripts, then node node_modules/electron/install.js. better-sqlite3 includes its Windows native binary. Run npm.cmd run package:win to build the installer. See DEPLOYMENT.md for release checks.
