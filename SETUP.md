# AgriPOS shop setup

AgriPOS keeps the shop database on one **main shop computer**. Every till, including the main computer itself, connects to that database over the shop network (Wi-Fi or cable), so all features keep working when the internet is down. A Neon PostgreSQL database is used as an automatic cloud backup. Product images and the shop logo stay on each desktop separately.

## 1. Prepare the main shop computer

1. Install [PostgreSQL for Windows](https://www.postgresql.org/download/windows/) (version 18 recommended) and remember the `postgres` user password you choose.
2. Give the computer a fixed IP address in your router (DHCP reservation) so the tills can always find it.
3. In Windows **Settings > Network**, set the shop network to **Private**.
4. Open PowerShell **as Administrator** in the AgriPOS folder and review, then run, the setup script:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\setup-shop-server.ps1 -DryRun
   powershell -ExecutionPolicy Bypass -File scripts\setup-shop-server.ps1
   ```

   It creates an `agripos` database user and database, allows password connections from the shop network only, opens the PostgreSQL port for that network in Windows Firewall, and prints the connection URLs. Use `-Network 192.168.1.0/24` if the detected network is wrong. The original `pg_hba.conf` is copied before it is changed.

A single-till shop can skip the network steps (2–4) and connect with the `postgres` user to `localhost`.

## 2. Connect AgriPOS on the main computer

1. Open AgriPOS and click **Connect your shop**.
2. Choose **The main shop computer**.
3. Shop database URL: `postgresql://agripos:PASSWORD@localhost:5432/agripos`. Percent-encode special characters in the password (for example `@` becomes `%40`).
4. Cloud backup URL (optional, recommended): in [Neon Console](https://console.neon.tech/), create an **empty** database using the same PostgreSQL major version as the main computer, choose **Connect**, turn **Connection pooling off**, and copy the direct URL with `sslmode=require`.
5. For a new shop, enter an initial administrator password of at least 12 characters and a shop name. Click **Save**. AgriPOS creates the database if needed, applies migrations, and creates the `admin` account.
6. Sign in as `admin`.

## 3. Connect each other till

Click **Connect your shop**, choose **A till**, and enter the URL printed by the setup script, for example `postgresql://agripos:PASSWORD@192.168.1.20:5432/agripos` (the main computer's fixed IP address or computer name). Leave the cloud backup URL and initial password empty.

Each till then has every feature: sales, credit, returns, purchasing, stock, reports and cash registers. Stock and credit limits stay correct because all tills use the same database.

## Backups

The main computer saves a backup file every 30 minutes and when you click **Settings > Backup and recovery > Back up now**. The last 48 files are kept in the AgriPOS application data folder under `backups`. When the internet is available, each backup also replaces the Neon cloud copy in a single transaction; if the copy fails, the previous cloud copy stays intact and Settings shows the error.

AgriPOS refuses to overwrite a cloud database that holds a different shop or newer activity than the main computer. That prevents an old till still connected directly to Neon from losing sales. Restoring and other recovery steps are in [DEPLOYMENT.md](DEPLOYMENT.md).

## When the main computer is unavailable

If a till cannot reach the main computer (for example, it is switched off), use **Offline & sync** for walk-in cash sales from a prepared snapshot. Receipts upload automatically once the main computer is reachable again. See [OFFLINE_SYNC.md](OFFLINE_SYNC.md).

## Build or develop

From CMD in the repository folder:

```cmd
npm ci
npm run dev
```

To build the Windows installer after code changes:

```cmd
npm run package:win
```

PowerShell users can type `npm.cmd` in place of `npm`. An installed AgriPOS app does not need Node, CMD or a repository `.env` file. `.env` and the `db:migrate`/`setup:admin` commands are for optional command-line administration and independent API deployment.

## Troubleshooting

- **A till cannot connect:** check that the main computer is on, the network is Private, the IP address in the URL is current, and the Windows Firewall rule "AgriPOS shop database" exists on the main computer.
- **Backup tools not found:** install PostgreSQL on the main computer, or set the `AGRIPOS_PG_BIN` environment variable to its `bin` folder.
- **Cloud copy refused:** read the message in Settings. Use an empty Neon database, and make sure no till still connects to Neon directly.
- **Image missing on another computer:** add it there; images are intentionally local.
