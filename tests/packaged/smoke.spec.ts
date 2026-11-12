import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
test('packaged Windows executable starts with a sandbox and loads native SQLite', async () => {
  const executablePath = resolve('apps/desktop/release/win-unpacked/AgriPOS.exe');
  expect(existsSync(executablePath), 'Build the Windows package first').toBe(true);
  expect(existsSync(resolve('apps/desktop/release/win-unpacked/resources/migrations'))).toBe(true);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.AGRIPOS_API_URL;
  const app = await electron.launch({
    executablePath,
    args: [],
    env: Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
      errors.join('\n'),
    ).toBeVisible({ timeout: 15000 });
    const info = await page.evaluate(() => window.desktop.info());
    expect(info.version).toBe('0.5.0');
    expect(info.contextIsolated).toBe(true);
    expect(info.sandboxed).toBe(true);
    expect(await page.evaluate(() => typeof Reflect.get(window, 'require'))).toBe('undefined');
    const native = await app.evaluate(({ app }) => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const Database = createRequire(`${app.getAppPath()}/package.json`)(
        'better-sqlite3',
      ) as typeof import('better-sqlite3');
      const Pg = createRequire(`${app.getAppPath()}/package.json`)('pg') as typeof import('pg');
      if (typeof Pg.Pool !== 'function') throw new Error('PostgreSQL driver is missing');
      const db = new Database(':memory:');
      const row = db.prepare('select sqlite_version() as version').get();
      db.close();
      return { version: (row as { version: string }).version };
    });
    expect(native.version).toMatch(/^3\./);
  } finally {
    await app.close();
  }
});
