import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { OfflineGrant } from '@agripos/shared';
import { OfflineStore } from './offline';
const codec = { encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
function fixture() {
  const now = Date.now(),
    p = randomUUID(),
    b = randomUUID(),
    c = randomUUID();
  const grant: OfflineGrant = {
    id: randomUUID(),
    token: 'test',
    actor: { id: randomUUID(), shopId: randomUUID(), name: 'Cashier', role: 'cashier' },
    terminalId: randomUUID(),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 43200000).toISOString(),
    products: [
      {
        id: p,
        name: 'Seed',
        sku: 'S',
        barcode: null,
        category_id: c,
        category: 'Seeds',
        kind: 'seed',
        unit: 'packet',
        selling_price: 15000,
        tax_bps: 0,
        minimum_stock: 0,
        active: true,
        stock: 5000,
        brand: '',
        description: '',
        attributes: {},
      },
    ],
    batches: [{ id: b, product_id: p, quantity: 5000, expiry_date: null }],
    categories: [{ id: c, name: 'Seeds', kind: 'seed' }],
    shop: { name: 'Test', address: '', phone: '', receipt_footer: '' },
    cashSessionId: null,
  };
  return {
    grant,
    now,
    sale: {
      operationId: randomUUID(),
      terminalId: grant.terminalId,
      lines: [{ productId: p, quantity: 1000 }],
      payments: [{ method: 'cash', amount: 15000 }],
      cashTendered: 20000,
    },
  };
}
it('commits cash receipts and queue atomically, survives restart and returns the same receipt on retry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agripos-offline-')),
    path = join(dir, 'offline.sqlite'),
    { grant, sale } = fixture();
  const target = resolve(dir);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('agripos-offline-'))
    throw new Error('Refusing cleanup outside the isolated offline test directory');
  let store = new OfflineStore(path, codec);
  try {
    store.provision('owner', grant, '12345678');
    store.unlock('owner', '12345678');
    const receipt = store.request({ method: 'POST', path: '/sales', body: sale }) as {
      id: string;
      change: number;
    };
    expect(receipt.change).toBe(5000);
    expect(store.queued('owner')).toHaveLength(1);
    store.close();
    store = new OfflineStore(path, codec);
    expect(() => store.request({ method: 'GET', path: '/sales' })).toThrow('Unlock');
    store.unlock('owner', '12345678');
    expect(store.request({ method: 'POST', path: '/sales', body: sale })).toEqual(receipt);
    expect(store.queued('owner')).toHaveLength(1);
    const products = store.request({ method: 'GET', path: '/products' }) as {
      items: { stock: number }[];
    };
    expect(products.items[0]!.stock).toBe(4000);
    store.begin(sale.operationId);
    store.settle({ id: sale.operationId, state: 'conflict', message: 'Cloud stock changed' });
    expect(store.status('owner').counts.conflict).toBe(1);
    expect(() => store.provision('owner', grant, '12345678')).toThrow('reconcile');
    store.settle({ id: sale.operationId, state: 'synced' });
    expect(store.queued('owner')).toHaveLength(0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it('rolls back stock on payment failure and blocks PIN guessing, expiration and clock rollback', () => {
  const { grant, sale, now } = fixture();
  let time = now;
  const store = new OfflineStore(':memory:', codec, () => time);
  try {
    store.provision('owner', grant, '12345678');
    for (let n = 0; n < 5; n++)
      expect(() => store.unlock('owner', '00000000')).toThrow('incorrect');
    expect(() => store.unlock('owner', '12345678')).toThrow('15 minutes');
    time += 900001;
    store.unlock('owner', '12345678');
    expect(() =>
      store.request({
        method: 'POST',
        path: '/sales',
        body: { ...sale, payments: [{ method: 'cash', amount: 1 }] },
      }),
    ).toThrow('must equal');
    expect(store.queued('owner')).toHaveLength(0);
    expect(
      (store.request({ method: 'GET', path: '/products' }) as { items: { stock: number }[] })
        .items[0]!.stock,
    ).toBe(5000);
    time -= 120000;
    expect(() => store.request({ method: 'GET', path: '/products' })).toThrow('clock');
    time = now + 43200001;
    expect(() => store.unlock('owner', '12345678')).toThrow('expired');
  } finally {
    store.close();
  }
});
