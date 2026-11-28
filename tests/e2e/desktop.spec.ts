import { test, expect, _electron as electron } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
test('desktop login → product → purchase receipt → sale → receipt → stock and report', async () => {
  const userData = test.info().outputPath('profile');
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  const launch = () =>
    electron.launch({
      args: [resolve('apps/desktop')],
      env: {
        ...launchEnv,
        AGRIPOS_TEST_USER_DATA: userData,
        AGRIPOS_API_URL: 'http://127.0.0.1:4199',
      },
      timeout: 30000,
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('Local-test-only-2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Good to see you, Test.' })).toBeVisible();
    await page.getByRole('link', { name: 'Cloud sync', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Neon cloud' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('sync-layout.png') });
    await page.getByRole('link', { name: 'Products', exact: true }).click();
    await page.getByRole('button', { name: 'Add category' }).click();
    await page.getByLabel('Category name').fill('Seeds');
    await page.getByLabel('Product type').selectOption('seed');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    await page.getByLabel('Product name').fill('Unsaved product');
    await page.getByRole('button', { name: 'Close form' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    await expect(page.getByLabel('Product name')).toHaveValue('');
    await page.getByLabel('Product name').fill('Tomato seeds');
    await expect(page.getByLabel('Product code', { exact: false })).toBeHidden();
    await page.getByLabel(/^Category \*/).selectOption({ label: 'Seeds' });
    await page.getByLabel('Purchase price (LKR)').fill('100');
    await page.getByLabel('Selling price (LKR)').fill('150');
    await expect(page.getByLabel('Low-stock threshold')).toBeHidden();
    await page.getByRole('dialog').screenshot({ path: test.info().outputPath('product-simple.png') });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText('Tomato seeds', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit Tomato seeds', exact: true }).click();
    await page.getByRole('button', { name: 'More details (optional)', exact: true }).click();
    await expect(page.getByLabel('Product code', { exact: false })).toHaveValue(/^P-[0-9A-F]{8}$/);
    await page.getByLabel('Low-stock threshold').fill('2');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('link', { name: 'Suppliers', exact: true }).click();
    await page.getByRole('button', { name: 'Add supplier' }).click();
    await page.getByLabel('Name', { exact: false }).fill('Green Nursery');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('link', { name: 'Purchases', exact: true }).click();
    await page.getByRole('button', { name: 'Create purchase order' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Supplier', { exact: false })
      .selectOption({ label: 'Green Nursery' });
    await page
      .getByRole('dialog')
      .getByLabel('Line 1 product', { exact: false })
      .selectOption({ index: 1 });
    await page.getByLabel('Line 1 quantity/cost unit').selectOption('base');
    await page.getByLabel(/^Line 1 quantity \*/).fill('5');
    await page.getByLabel('Line 1 cost per selected unit').fill('100');
    await page.getByRole('button', { name: 'Create order', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('button', { name: 'Receive goods' }).click();
    await page.getByLabel('Order line').selectOption({ index: 1 });
    await page.getByLabel('Quantity received').fill('5');
    await page.getByLabel('Batch / lot number').fill('TEST-LOT-01');
    await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('link', { name: 'Point of sale', exact: true }).click();
    await page.getByRole('button', { name: /Seeds Tomato seeds/ }).click();
    await page.getByRole('button', { name: 'Take payment' }).click();
    await page.getByRole('button', { name: 'Confirm sale', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sales history' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print receipt', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Inventory', exact: true }).click();
    await expect(page.getByRole('cell', { name: '4 piece', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page.getByRole('cell', { name: /150/ }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View records' }).first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('notifications.png'), fullPage: true });
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.screenshot({ path: test.info().outputPath('dashboard.png'), fullPage: true });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: test.info().outputPath('dashboard-dark.png'), fullPage: true });
    // Lose the server acknowledgment AFTER commit; the SQLite journal must survive a restart.
    await app.evaluate(() => {
      const original = globalThis.fetch;
      globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await original(...args);
        if (String(args[0]).endsWith('/api/v1/sales') && args[1]?.method === 'POST') {
          globalThis.fetch = original;
          throw new Error('Simulated lost acknowledgment');
        }
        return response;
      };
    });
    await page.getByRole('link', { name: 'Point of sale', exact: true }).click();
    await page.getByRole('button', { name: /Seeds Tomato seeds/ }).click();
    await page.getByRole('button', { name: 'Take payment' }).click();
    await page.getByRole('button', { name: 'Confirm sale', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry identical transaction' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(async () => (await window.desktop.pendingSales()).length))
      .toBe(1);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Good to see you, Test.' })).toBeVisible();
    await page.getByRole('link', { name: 'Point of sale', exact: true }).click();
    await page.getByRole('button', { name: 'Retry payment submission' }).click();
    await page.getByRole('button', { name: 'Retry identical transaction' }).click();
    await expect(page.getByRole('heading', { name: 'Sales history' })).toBeVisible();
    expect(await page.evaluate(async () => (await window.desktop.pendingSales()).length)).toBe(0);
    const sales = await page.evaluate(
      async () => await window.desktop.request<{ id: string }[]>({ method: 'GET', path: '/sales' }),
    );
    expect(sales.data).toHaveLength(2);
    await page.getByRole('link', { name: 'Inventory', exact: true }).click();
    await expect(page.getByRole('cell', { name: '3 piece', exact: true })).toBeVisible();
    // Disconnect the cloud while the local POS keeps the same login, permissions and UI.
    await fetch('http://127.0.0.1:4199/__fixture/connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offline: true }),
    });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('Local-test-only-2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Good to see you, Test.' })).toBeVisible();
    await page.getByRole('link', { name: 'Point of sale', exact: true }).click();
    await page.getByRole('button', { name: /Seeds Tomato seeds/ }).click();
    await page.getByRole('button', { name: 'Take payment' }).click();
    await page.getByRole('button', { name: 'Confirm sale', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sales history' })).toBeVisible();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Good to see you, Test.' })).toBeVisible();
    await fetch('http://127.0.0.1:4199/__fixture/connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offline: false }),
    });
    const synchronized = await (
      await fetch('http://127.0.0.1:4199/__fixture/sync', { method: 'POST' })
    ).json();
    expect(synchronized).toEqual({ pending: false, error: null });
    await page.getByRole('link', { name: 'Inventory', exact: true }).click();
    await expect(page.getByRole('cell', { name: '2 piece', exact: true })).toBeVisible();
    const finalSales = await page.evaluate(() =>
      window.desktop.request<{ id: string }[]>({ method: 'GET', path: '/sales' }),
    );
    expect(finalSales.data).toHaveLength(3);
    const pdfPath = resolve(userData, 'verified-receipt.pdf');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, pdfPath);
    const printed = await page.evaluate(
      (saleId) => window.desktop.printReceipt({ saleId, printer: '', paper: '80mm', pdf: true }),
      finalSales.data![0]!.id,
    );
    expect(printed.cancelled).toBe(false);
    expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe('%PDF-');
    await page.getByRole('link', { name: 'Staff & roles' }).click();
    await page.getByRole('button', { name: 'Add staff account' }).click();
    await page.getByLabel('Employee name').fill('Daily staff');
    await page.getByLabel('Username').fill('test_till');
    await page.getByLabel('Initial password').fill('Restricted-test-only');
    await page.getByLabel('Role', { exact: false }).selectOption('daily_sales');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Username').fill('test_till');
    await page.getByLabel('Password', { exact: true }).fill('Restricted-test-only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Point of sale' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Products', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sales history' })).toHaveCount(0);
    await page.getByRole('button', { name: /Seeds Tomato seeds/ }).click();
    await page.getByRole('button', { name: 'Take payment' }).click();
    await page.getByRole('button', { name: 'Confirm sale', exact: true }).click();
    await expect(page.getByRole('heading', { name: "Today's sales" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print receipt', exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
