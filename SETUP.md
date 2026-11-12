# AgriPOS setup with Neon

AgriPOS runs its API inside the Windows desktop app. Business records and account hashes live in Neon PostgreSQL. Product images and the shop logo stay on each desktop separately. Firebase, Supabase, Google Cloud billing, and a separate API command are not required.

## First launch

1. In [Neon Console](https://console.neon.tech/), open your project, choose **Connect**, select your database and role, turn **Connection pooling off**, and copy the **direct** PostgreSQL connection URL. Keep its `sslmode=require` setting. [Neon connection guide](https://neon.com/docs/connect/connect-from-any-app).
2. Install and open AgriPOS. Click **Connect your shop** on the sign-in screen.
3. Paste the Neon URL. For a new empty database, enter an initial administrator password of at least 12 characters and optionally a shop name. Click **Save**. AgriPOS creates the tables, creates the first `admin` account, and starts its local API automatically.
4. Sign in with username `admin` and your chosen password. Change it from Settings if you previously shared it.

You only need the URL again if you move to a new Windows profile or reinstall without retaining the app profile. The URL is encrypted in that profile using Windows secure storage. Do not send it in chat or put it in source code. Each desktop connects to the same Neon database, but images must be added on each desktop separately.

## Existing Neon database

If the database already contains an active administrator with a username and password hash, paste only the URL. If it contains a shop and an administrator staff row without a username, provide that staff row's UUID in **Existing administrator staff ID** and choose an initial password. This links the existing administrator to the `admin` login. Back up existing shop data before migrating it.

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

PowerShell users can type `npm.cmd` in place of `npm`. An installed AgriPOS app does not need Node, CMD, `npm run dev:api`, or a repository `.env` file. `.env` and the old `db:migrate`/`setup:admin` commands are for optional command-line administration and independent API deployment.

## Backups and troubleshooting

Back up Neon data and each desktop's AgriPOS user profile independently. Synchronize pending offline sales before changing databases. If login says to connect your shop, open **Connect your shop** and paste the direct Neon URL. If connection fails, check internet access, the Neon role/password, SSL option and whether the project is active. If an image is missing on another computer, add it there; images are intentionally local.

The old Firebase SQL Connect/Cloud SQL trial is separate from this application. Changing AgriPOS does not cancel that cloud resource.
