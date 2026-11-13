# AgriPOS

Windows desktop POS and inventory management for agricultural retailers in Sri Lanka. The Electron app starts its Express API locally on every till. All tills share a PostgreSQL database on the main shop computer over the shop network, so every feature works during internet outages; the main computer backs it up to Neon automatically. Images and encrypted SQLite transaction payloads stay on each desktop.

See [PROGRESS.md](PROGRESS.md) for release verification and remaining scope. A live Neon connection, physical printer, and signing certificate are not configured in this repository. The included authentication fixtures are isolated tests, never production login bypasses.

Start with [SETUP.md](SETUP.md) for the main shop computer, tills, cloud backup, first administrator and deployment.

## Requirements

- Windows x64 for desktop packaging and hardware validation.
- Node.js 24.13 or later in the 24.x line; npm (one package manager and committed `package-lock.json`).
- PostgreSQL (18 recommended) on the main shop computer, and a shop network for other tills. A Neon database is optional, as the cloud backup.

## Development setup

1. Run `npm.cmd ci` at the repository root.
2. Run `npm.cmd run dev`.
3. Choose **Connect your shop**, select **The main shop computer**, enter a PostgreSQL URL such as `postgresql://postgres:PASSWORD@localhost:5432/agripos`, and set an initial administrator password. AgriPOS creates the database, applies migrations and starts the local API automatically.
4. Sign in as `admin` with the password you chose.

For a real shop, use the production provisioning instructions in [DEPLOYMENT.md](DEPLOYMENT.md), not the development seed.

## Commands

PowerShell users should use `npm.cmd` to avoid execution-policy restrictions on `npm.ps1`.

| Purpose                              | Command                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| Install locked dependencies          | `npm.cmd ci`                                                     |
| Desktop and embedded API development | `npm.cmd run dev`                                                |
| Desktop development                  | `npm.cmd run dev:desktop`                                        |
| API development                      | `npm.cmd run dev:api`                                            |
| Strict TypeScript                    | `npm.cmd run typecheck`                                          |
| Lint                                 | `npm.cmd run lint`                                               |
| Format / check formatting            | `npm.cmd run format` / `npm.cmd run format:check`                |
| All unit/integration tests           | `npm.cmd test -- --configLoader native`                          |
| Shared and desktop unit tests        | `npm.cmd run test:unit -- --configLoader native`                 |
| API integration tests                | `npm.cmd run test:integration -- --configLoader native`          |
| Windows Electron workflows           | `npm.cmd run test:e2e`                                           |
| Apply SQL migrations                 | `npm.cmd run db:migrate`                                         |
| Provision the first administrator    | `npm.cmd run setup:admin`                                        |
| Share PostgreSQL on the shop network | `scripts\setup-shop-server.ps1 -DryRun` (then without, as admin) |
| Check API and SQL setup              | `npm.cmd run setup:check`                                        |
| Create development training shop     | `npm.cmd run db:seed`                                            |
| Build both applications              | `npm.cmd run build`                                              |
| Build API / desktop                  | `npm.cmd run build:api` / `npm.cmd run build:desktop`            |
| Validate native SQLite binary        | `npm.cmd run native:check -w @agripos/desktop`                   |
| Build Windows NSIS installer         | `npm.cmd run package:win`                                        |
| Packaged executable smoke test       | `npx.cmd playwright test --config playwright.packaged.config.ts` |

The native Vitest config loader avoids esbuild config discovery problems in restricted Windows environments. Production bundling and Electron launches may need execution permissions beyond a filesystem sandbox. Do not disable application sandboxing to work around development-tool restrictions.

## Documentation

- [Architecture](ARCHITECTURE.md), [database](DATABASE.md), [API](API.md)
- [Design system](DESIGN_SYSTEM.md), [offline synchronization](OFFLINE_SYNC.md), [security](SECURITY.md)
- [Deployment and backup](DEPLOYMENT.md), [user guide](USER_GUIDE.md), [current progress](PROGRESS.md)

## Repository

`apps/api` supplies the Express API embedded by `apps/desktop/electron`, and can also be deployed independently. `apps/desktop/src` contains the renderer. Shared contracts, permissions, and integer calculations live in `packages/shared`; reusable UI primitives live in `packages/ui`. SQL migrations are in `supabase/migrations`.

Tests use real PostgreSQL semantics through PGlite, real SQLite, and an actual Electron process. They do not establish that a live Neon project, payment provider, or physical printer has been configured successfully.
