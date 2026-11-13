import { expect, it } from 'vitest';
import { paymentReceiptHtml, receiptHtml } from './receipt-html';
const shop = {
  name: 'Green Valley Agro',
  address: 'Kandy Road',
  phone: '081 222 3333',
  receipt_footer: 'Thank you!',
};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
it('TEST 17: prints items, units, driver and bill discounts, cash, credit and installments', () => {
  const html = text(
    receiptHtml(
      {
        id: 'sale-1',
        invoice_number: 'AGR-000042',
        created_at: '2026-01-10T04:30:00Z',
        cashier: 'Owner',
        subtotal: 2120000,
        total: 2000000,
        tax: 0,
        discount: 120000,
        bill_discount: 113000,
        credit: 1200000,
        cash_tendered: 1000000,
        change: 200000,
        shop,
        customer: {
          name: 'Nimal Perera',
          kind: 'driver',
          driver_code: 'DRV-0001',
          factory: 'Ceylon Tea Factory',
          lorry_number: 'LB-1234',
        },
        lines: [
          {
            name: 'Fertilizer A — 25 kg bag',
            quantity: 3000,
            unit: 'bag',
            unit_price: 280000,
            discount: 4000,
            auto_discount: 3000,
            total: 836000,
          },
          {
            name: 'Knapsack sprayer',
            quantity: 1000,
            unit: 'piece',
            unit_price: 1000000,
            discount: 0,
            total: 1000000,
          },
        ],
        payments: [{ method: 'cash', amount: 800000 }],
        installments: [
          { seq: 1, due_date: '2026-02-10', amount: 600000, remaining: 600000 },
          { seq: 2, due_date: '2026-03-10', amount: 600000, remaining: 600000 },
        ],
      },
      '80mm',
    ),
  );
  for (const expected of [
    'AGR-000042',
    'Lorry driver: Nimal Perera (DRV-0001)',
    'Factory: Ceylon Tea Factory',
    'Lorry: LB-1234',
    '3 bag × LKR 2,800.00',
    'Driver discount - LKR 30.00',
    'Bill discount - LKR 1,130.00',
    'Total discount LKR 1,200.00',
    'Total LKR 20,000.00',
    'Cash paid LKR 8,000.00',
    'Change LKR 2,000.00',
    'Credit LKR 12,000.00',
    'Part paid / credit',
    'Installments',
    'LKR 6,000.00',
    'Thank you!',
  ])
    expect(html).toContain(expected);
  expect(html).toContain('Item discounts - LKR 40.00');
});
it('omits empty fields for a paid walk-in sale', () => {
  const html = text(
    receiptHtml(
      {
        id: 'sale-2',
        created_at: '2026-01-10T04:30:00Z',
        cashier: 'Owner',
        total: 15000,
        tax: 0,
        discount: 0,
        credit: 0,
        cash_tendered: 15000,
        change: 0,
        shop: { ...shop, address: '', phone: '' },
        lines: [
          { name: 'Loose fertilizer', quantity: 1250, unit: 'kg', unit_price: 12000, total: 15000 },
        ],
        payments: [{ method: 'cash', amount: 15000 }],
      },
      '58mm',
    ),
  );
  expect(html).toContain('Walk-in customer');
  expect(html).toContain('1.25 kg');
  for (const absent of [
    'Credit LKR',
    'Driver discount',
    'Bill discount',
    'Installments',
    'Change',
    'Tax',
  ])
    expect(html).not.toContain(absent);
  expect(html).toContain('Payment status Paid');
});
it('prints a payment receipt with the installments it settled', () => {
  const html = text(
    paymentReceiptHtml(
      {
        id: 'abcdef12-0000-4000-8000-000000000000',
        created_at: '2026-02-10T04:30:00Z',
        amount: 400000,
        method: 'cash',
        notes: 'Part of February',
        customer_name: 'Nimal Perera',
        customer_kind: 'driver',
        driver_code: 'DRV-0001',
        factory: 'Ceylon Tea Factory',
        cashier: 'Owner',
        balance_after: 2800000,
        shop,
        allocations: [
          {
            amount: 400000,
            seq: 1,
            due_date: '2026-02-10',
            installment_count: 2,
            invoice_number: 'AGR-000042',
          },
        ],
      },
      '80mm',
    ),
  );
  for (const expected of [
    'CREDIT PAYMENT RECEIPT',
    'Lorry driver: Nimal Perera (DRV-0001)',
    'AGR-000042 · installment 1 of 2',
    'Amount paid LKR 4,000.00',
    'Balance remaining LKR 28,000.00',
  ])
    expect(html).toContain(expected);
});
