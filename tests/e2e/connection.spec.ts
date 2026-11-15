import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

test('first-use setup and connected/disconnected indicators', async () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGRIPOS_TEST_USER_DATA: await mkdtemp(resolve('.cache/connection-ui-')),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.AGRIPOS_API_URL;
  const app = await electron.launch({
    args: [resolve('apps/desktop')],
    env: Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connect your shop' })).toBeVisible();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('connection:configure');
      ipcMain.handle('connection:configure', () => {
        ipcMain.removeHandler('backup:status');
        ipcMain.handle('backup:status', () => ({
          cloudConfigured: true,
          running: false,
          lastCloudAt: new Date().toISOString(),
          lastError: null,
        }));
        ipcMain.removeHandler('app:info');
        ipcMain.handle('app:info', () => ({ configured: true }));
      });
    });
    await page
      .getByLabel('Neon cloud database URL', { exact: false })
      .fill('postgresql://test:example@localhost/test');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: /Shop connected/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: /Shop connected/ })).toBeVisible();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.screenshot({ path: resolve('.cache/connection-connected.png') });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('backup:status');
      ipcMain.handle('backup:status', () => ({
        cloudConfigured: true,
        running: false,
        lastCloudAt: new Date().toISOString(),
        lastError: 'Cannot reach Neon',
      }));
    });
    await expect(page.getByRole('button', { name: /Cloud disconnected/ })).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole('button', { name: /Cloud disconnected/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  } finally {
    await app.close();
  }
});
