# AgriPOS

Windows desktop POS for agricultural retailers. SQLite runs the complete shop locally, with the same login and permissions offline. One Neon database synchronizes products, sales, credit, staff and images. No local PostgreSQL installation or offline PIN is required.

See [PROGRESS.md](PROGRESS.md) for release verification and remaining scope. A live Neon connection, physical printer, and signing certificate are not configured in this repository. The included authentication fixtures are isolated tests, never production login bypasses.

Start with [SETUP.md](SETUP.md) for installation and the single cloud connection.

## Requirements

- Windows x64 for desktop packaging and hardware validation.
- Node.js 24.13 or later in the 24.x line; npm (one package manager and committed `package-lock.json`).
- One Neon PostgreSQL database and internet for the first synchronization.

## Development setup

1. Run `npm.cmd ci` at the repository root.
2. Run `npm.cmd run dev`.
3. Choose **Connect your shop**, enter your Neon URL, and set an initial administrator password only for a new shop.
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

`apps/api` supplies the Express API embedded by `apps/desktop/electron`, and can also be deployed independently. `apps/desktop/src` contains the renderer. Shared contracts, permissions, and integer calculations live in `packages/shared`. Reusable desktop components live in `apps/desktop/src/components`. SQL migrations are in `migrations`.

Tests use real PostgreSQL semantics through PGlite, real SQLite, and an actual Electron process. They do not establish that a live Neon project, payment provider, or physical printer has been configured successfully.
