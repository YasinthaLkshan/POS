import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
test('factory → driver → variants → driver credit sale → partial payment → receipts', async () => {
  const userData = await mkdtemp(resolve('.cache/e2e-credit-profile-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [resolve('apps/desktop')],
    env: { ...env, AGRIPOS_TEST_USER_DATA: userData, AGRIPOS_API_URL: 'http://127.0.0.1:4199' },
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('Local-test-only-2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();

    await page.getByRole('link', { name: 'Factories', exact: true }).click();
    await page.getByRole('button', { name: 'Add factory' }).click();
    await page.getByRole('dialog').getByLabel('Factory name').fill('Hill Country Tea');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByLabel('Search factories').fill('hill');
    await expect(page.getByRole('button', { name: 'Hill Country Tea', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Lorry drivers', exact: true }).click();
    await page.getByRole('button', { name: 'Add driver' }).click();
    await page.getByRole('dialog').getByLabel('Driver name').fill('Ruwan Jayasinghe');
    await page
      .getByRole('dialog')
      .getByLabel(/^Factory/)
      .selectOption({ label: 'Hill Country Tea' });
    await page.getByRole('dialog').getByLabel('Lorry registration number').fill('WP-LA-4455');
    await page.getByRole('button', { name: 'Save driver' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText('Ruwan Jayasinghe')).toBeVisible();

    await page.getByRole('link', { name: 'Products', exact: true }).click();
    await page.getByRole('button', { name: 'Add category' }).click();
    await page.getByRole('dialog').getByLabel('Category name').fill('Fertilizers');
    await page.getByRole('dialog').getByLabel('Product type').selectOption('fertilizer');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('button', { name: 'Add product with sizes' }).click();
    await page.getByRole('dialog').getByLabel('Product name').fill('Super Fertilizer');
    await page
      .getByRole('dialog')
      .getByLabel(/^Category/)
      .selectOption({ label: 'Fertilizers' });
    for (const [i, sku, price, discount] of [
      [1, 'SF-L', '120', ''],
      [2, 'SF-25', '2800', '10'],
      [3, 'SF-50', '5400', '20'],
    ] as const) {
      await page.getByRole('dialog').getByLabel(`Size ${i} SKU`).fill(sku);
      await page.getByLabel(`Size ${i} price`).fill(price);
      if (discount) await page.getByLabel(`Size ${i} driver discount`).fill(discount);
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const bag = await page.evaluate(async () => {
      const result = await window.desktop.request<{
        items: { id: string; variant_label: string }[];
      }>({
        method: 'GET',
        path: '/products?search=Super%20Fertilizer',
      });
      return result.data!.items.find((p) => p.variant_label === '25 kg bag')!.id;
    });
    await page.getByRole('link', { name: 'Inventory', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Product / variant').selectOption(bag);
    await page
      .getByRole('dialog')
      .getByLabel(/^Quantity received/)
      .fill('10');
    await page.getByRole('button', { name: 'Add stock' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('link', { name: 'Point of sale', exact: true }).click();
    await page.getByRole('button', { name: 'Lorry driver', exact: true }).click();
    await page.getByLabel('Find lorry driver').fill('Ruwan');
    await page.getByRole('button', { name: /Ruwan Jayasinghe/ }).click();
    const chip = page.getByRole('button', { name: 'Add Super Fertilizer — 25 kg bag' });
    for (let i = 0; i < 3; i++) await chip.click();
    await expect(page.locator('.cart-totals .discount-row')).toContainText('30.00');
    await expect(page.locator('.grand-total')).toContainText('8,370.00');
    await page.getByRole('button', { name: 'Take payment' }).click();
    await page
      .getByRole('dialog')
      .getByLabel(/Cash paid now/)
      .fill('4000');
    await page
      .getByRole('dialog')
      .getByLabel(/Cash received/)
      .fill('5000');
    await expect(page.locator('.checkout-summary .credit')).toContainText('4,370.00');
    await expect(page.getByRole('dialog').getByLabel('Installment 2 amount')).toHaveValue('2185');
    await page.getByRole('button', { name: 'Confirm sale', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sales history' })).toBeVisible();
    await expect(page.locator('.receipt-totals')).toContainText('4,370.00');
    await expect(page.locator('.receipt-installments')).toContainText('2,185.00');
    const saleId = new URL(page.url().replace('#', '')).searchParams.get('id')!;

    await page.getByRole('link', { name: 'Credit management', exact: true }).click();
    await page.getByLabel('Search credit').fill('Ruwan');
    await expect(page.getByRole('cell', { name: /Ruwan Jayasinghe/ }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Record payment' }).first().click();
    await page
      .getByRole('dialog')
      .getByLabel(/^Amount \(LKR\)/)
      .fill('1000');
    await expect(page.getByRole('dialog').locator('tbody')).toContainText('1,185.00');
    await page.getByRole('button', { name: 'Confirm LKR 1,000.00' }).click();
    await expect(page.getByRole('heading', { name: 'Payment recorded' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('link', { name: 'Lorry drivers', exact: true }).click();
    await page.getByRole('link', { name: 'Profile' }).first().click();
    await expect(page.getByRole('heading', { name: 'Ruwan Jayasinghe' })).toBeVisible();
    await expect(page.locator('.stat-card', { hasText: 'Outstanding' })).toContainText('3,370.00');
    await expect(page.locator('.stat-card', { hasText: 'Credit repaid' })).toContainText(
      '1,000.00',
    );

    await page.getByRole('link', { name: 'Daily business', exact: true }).click();
    await expect(page.locator('.summary-line', { hasText: 'Repayments received' })).toContainText(
      '1,000.00',
    );

    const pdfs = { sale: resolve(userData, 'sale.pdf'), payment: resolve(userData, 'payment.pdf') };
    const payment = await page.evaluate(async () => {
      const due = await window.desktop.request<{ id: string; customer_id: string }[]>({
        method: 'GET',
        path: '/drivers?search=Ruwan',
      });
      const profile = await window.desktop.request<{ payments: { id: string }[] }>({
        method: 'GET',
        path: `/drivers/${due.data![0]!.id}`,
      });
      return profile.data!.payments[0]!.id;
    });
    for (const [file, action] of [
      [
        pdfs.sale,
        () =>
          page.evaluate(
            (id) =>
              window.desktop.printReceipt({ saleId: id, printer: '', paper: '80mm', pdf: true }),
            saleId,
          ),
      ],
      [
        pdfs.payment,
        () =>
          page.evaluate(
            (id) =>
              window.desktop.printPaymentReceipt({
                paymentId: id,
                printer: '',
                paper: '80mm',
                pdf: true,
              }),
            payment,
          ),
      ],
    ] as const) {
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, file);
      expect((await action()).cancelled).toBe(false);
      expect((await readFile(file)).subarray(0, 5).toString()).toBe('%PDF-');
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
