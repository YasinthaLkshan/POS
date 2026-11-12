import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { testDatabase } from './database';
import type { Database } from '../src/database/db';
import { AppError } from '../src/utils/errors';
import type { Actor } from '@agripos/shared';
let db: Database, api: ReturnType<typeof createApp>;
const admin: Actor = {
  id: randomUUID(),
  shopId: randomUUID(),
  name: 'Test administrator',
  role: 'administrator',
};
const cashier: Actor = { ...admin, id: randomUUID(), role: 'cashier' };
let categoryId: string, supplierId: string, productId: string, purchaseId: string, lineId: string;
const terminalId = randomUUID();
const post = (url: string, body: object, token = 'admin') =>
  request(api).post(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).send(body);
const get = (url: string, token = 'admin') =>
  request(api).get(`/api/v1${url}`).set('Authorization', `Bearer ${token}`);
beforeAll(async () => {
  db = await testDatabase();
  await db.query('INSERT INTO shops(id,name) VALUES($1,$2)', [admin.shopId, 'Test shop']);
  for (const actor of [admin, cashier])
    await db.query('INSERT INTO staff(id,shop_id,name,role) VALUES($1,$2,$3,$4)', [
      actor.id,
      actor.shopId,
      actor.name,
      actor.role,
    ]);
  api = createApp(db, async (token) => {
    if (token === 'admin') return admin;
    if (token === 'cashier') return cashier;
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid session');
  });
});
afterAll(async () => {
  await db?.close();
});
describe('authenticated retail workflows with actual PostgreSQL transactions', () => {
  it('rejects missing or invalid authentication and unauthorized mutations', async () => {
    expect((await request(api).get('/api/v1/products')).status).toBe(401);
    expect((await get('/products', 'invalid')).status).toBe(401);
    expect((await post('/categories', { name: 'Seeds' }, 'cashier')).status).toBe(403);
  });
  it('creates real products and prevents duplicates and invalid input', async () => {
    categoryId = (await post('/categories', { name: 'Seeds', kind: 'seed' })).body.data.id;
    supplierId = (await post('/suppliers', { name: 'Test nursery' })).body.data.id;
    const product = {
      name: 'Tomato seed',
      sku: 'SEED-001',
      categoryId,
      sellingPrice: 150000,
      purchasePrice: 100000,
      minimumStock: 1000,
    };
    const response = await post('/products', product);
    expect(response.status, response.text).toBe(201);
    productId = response.body.data.id;
    expect((await post('/products', product)).status).toBe(409);
    expect((await post('/products', { ...product, sku: 'INVALID', sellingPrice: -1 })).status).toBe(
      422,
    );
    const catalog = await get('/products', 'cashier');
    expect(catalog.body.data.items[0]).not.toHaveProperty('purchase_price');
  });
  it('orders do not add stock; partial receiving is atomic and idempotent', async () => {
    purchaseId = (
      await post('/purchases', {
        supplierId,
        lines: [{ productId, quantity: 10000, unitCost: 100000 }],
      })
    ).body.data.id;
    expect((await get('/inventory')).body.data).toHaveLength(0);
    lineId = (await get(`/purchases/${purchaseId}`)).body.data.lines[0].id;
    const receipt = {
      operationId: randomUUID(),
      lines: [{ lineId, quantity: 5000, batchNumber: 'LOT-A', expiryDate: '2099-12-31' }],
    };
    expect((await post(`/purchases/${purchaseId}/receive`, receipt)).body.data.status).toBe(
      'partial',
    );
    expect((await post(`/purchases/${purchaseId}/receive`, receipt)).status).toBe(200);
    expect((await get('/inventory')).body.data).toHaveLength(1);
    expect(
      (
        await post(`/purchases/${purchaseId}/receive`, {
          ...receipt,
          operationId: randomUUID(),
          lines: [{ ...receipt.lines[0], quantity: 6000 }],
        })
      ).status,
    ).toBe(409);
  });
  it('completes sale, snapshots cost, decrements stock once and rejects key reuse', async () => {
    const sale = {
      operationId: randomUUID(),
      terminalId,
      lines: [{ productId, quantity: 2000 }],
      payments: [{ method: 'cash', amount: 300000 }],
      cashTendered: 350000,
    };
    const response = await post('/sales', sale);
    expect(response.status, response.text).toBe(201);
    expect(response.body.data.change).toBe(50000);
    expect((await post('/sales', sale)).body.data.id).toBe(sale.operationId);
    expect((await get('/inventory')).body.data[0].quantity).toBe(3000);
    expect((await get(`/sales/${sale.operationId}`)).body.data.cost).toBe(200000);
    expect((await post('/sales', { ...sale, cashTendered: 360000 })).status).toBe(409);
  });
  it('rolls back failed sales and never oversells competing requests', async () => {
    const countBefore = (await get('/sales')).body.data.length;
    const sale = () => ({
      operationId: randomUUID(),
      terminalId,
      lines: [{ productId, quantity: 2000 }],
      payments: [{ method: 'cash', amount: 300000 }],
    });
    const results = await Promise.all([post('/sales', sale()), post('/sales', sale())]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await get('/inventory')).body.data[0].quantity).toBe(1000);
    expect((await get('/sales')).body.data.length).toBe(countBefore + 1);
  });
  it('enforces external payment confirmation and cashier discount restrictions', async () => {
    const sale = {
      operationId: randomUUID(),
      terminalId,
      lines: [{ productId, quantity: 1000, discount: 10 }],
      payments: [{ method: 'cash', amount: 149990 }],
    };
    expect((await post('/sales', sale, 'cashier')).status).toBe(403);
    expect(
      (
        await post('/sales', {
          ...sale,
          lines: [{ productId, quantity: 1000 }],
          payments: [{ method: 'card', amount: 150000 }],
        })
      ).status,
    ).toBe(422);
  });
  it('records credit as immutable ledger entries and prevents overpayment', async () => {
    const customerId = (await post('/customers', { name: 'Test farmer', creditLimit: 200000 })).body
      .data.id;
    const sale = await post('/sales', {
      operationId: randomUUID(),
      terminalId,
      customerId,
      dueDate: '2099-12-31',
      lines: [{ productId, quantity: 1000 }],
      payments: [{ method: 'cash', amount: 100000 }],
    });
    expect(sale.status, sale.text).toBe(201);
    expect(sale.body.data.credit).toBe(50000);
    const payment = { operationId: randomUUID(), payment: { method: 'cash', amount: 30000 } };
    expect((await post(`/customers/${customerId}/payments`, payment)).body.data.balance).toBe(
      20000,
    );
    expect((await post(`/customers/${customerId}/payments`, payment)).body.data.balance).toBe(
      20000,
    );
    expect(
      (await post(`/customers/${customerId}/payments`, { ...payment, operationId: randomUUID() }))
        .status,
    ).toBe(409);
    expect((await get(`/customers/${customerId}/ledger`)).body.data).toHaveLength(2);
    await expect(db.query('UPDATE customer_ledger SET amount=0')).rejects.toThrow('immutable');
  });
  it('returns a paid sale once and keeps unsellable stock out of inventory', async () => {
    const sales = (await get('/sales')).body.data as { id: string; credit: number }[];
    const sale = sales.find((s) => s.credit === 0)!;
    const payload = { operationId: randomUUID(), reason: 'Damaged packaging', restock: false };
    const response = await post(`/sales/${sale.id}/returns`, payload);
    expect(response.status, response.text).toBe(201);
    expect((await post(`/sales/${sale.id}/returns`, payload)).status).toBe(201);
    expect(
      (await post(`/sales/${sale.id}/returns`, { ...payload, operationId: randomUUID() })).status,
    ).toBe(409);
    expect((await get('/inventory')).body.data[0].quantity).toBe(0);
  });
  it('prevents cross-shop foreign references and exposes live low-stock alerts', async () => {
    const otherShop = randomUUID(),
      otherCategory = randomUUID();
    await db.query('INSERT INTO shops(id,name) VALUES($1,$2)', [otherShop, 'Another shop']);
    await db.query("INSERT INTO categories(id,shop_id,name,kind) VALUES($1,$2,'Other','other')", [
      otherCategory,
      otherShop,
    ]);
    expect(
      (
        await post('/products', {
          name: 'Invalid',
          sku: 'CROSS',
          categoryId: otherCategory,
          sellingPrice: 10,
          purchasePrice: 5,
        })
      ).status,
    ).toBe(422);
    expect((await get('/dashboard/alerts')).body.data[0].stock).toBe(0);
    expect((await get('/dashboard/summary')).body.data.low_stock).toBe(1);
  });
  it('validates reporting ranges and calculates a persisted sales aggregate', async () => {
    const response = await get('/reports/sales?from=2026-01-01&to=2026-12-31');
    expect(response.status, response.text).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect((await get('/reports/sales?from=2026-12-31&to=2026-01-01')).status).toBe(422);
    expect((await get('/reports/profit?from=2026-01-01&to=2026-12-31', 'cashier')).status).toBe(
      403,
    );
  });
  it('rolls back a multi-line receipt if any line exceeds the order', async () => {
    const before = (await get('/inventory')).body.data.length;
    const bad = await post(`/purchases/${purchaseId}/receive`, {
      operationId: randomUUID(),
      lines: [
        { lineId, quantity: 1000, batchNumber: 'ROLLBACK' },
        { lineId: randomUUID(), quantity: 1000, batchNumber: 'MISSING' },
      ],
    });
    expect(bad.status).toBe(404);
    expect((await get('/inventory')).body.data).toHaveLength(before);
    const order = await get(`/purchases/${purchaseId}`);
    expect(order.body.data.lines[0].received).toBe(5000);
  });
  it('selects first-expiring stock, excludes expired batches, and rejects excessive discounts', async () => {
    for (const [batchNumber, expiryDate] of [
      ['SOON', '2098-01-01'],
      ['EXPIRED', '2000-01-01'],
      ['LATER', '2099-01-01'],
    ]) {
      const response = await post(`/purchases/${purchaseId}/receive`, {
        operationId: randomUUID(),
        lines: [{ lineId, quantity: 1000, batchNumber, expiryDate }],
      });
      expect(response.status, response.text).toBe(200);
    }
    const sale = {
      operationId: randomUUID(),
      terminalId,
      lines: [{ productId, quantity: 1000 }],
      payments: [{ method: 'cash', amount: 150000 }],
    };
    expect(
      (await post('/sales', { ...sale, lines: [{ productId, quantity: 1000, discount: 150001 }] }))
        .status,
    ).toBe(422);
    expect((await post('/sales', sale)).status).toBe(201);
    const batches = (await get('/inventory')).body.data as {
      id: string;
      batch_number: string;
      quantity: number;
    }[];
    expect(batches.find((b) => b.batch_number === 'SOON')?.quantity).toBe(0);
    expect(batches.find((b) => b.batch_number === 'EXPIRED')?.quantity).toBe(1000);
    expect(batches.find((b) => b.batch_number === 'LATER')?.quantity).toBe(1000);
    expect(
      (
        await post(`/sales/${sale.operationId}/returns`, {
          operationId: randomUUID(),
          reason: 'Verified sellable',
          restock: true,
        })
      ).status,
    ).toBe(201);
    const restored = (await get('/inventory')).body.data as {
      batch_number: string;
      quantity: number;
    }[];
    expect(restored.find((b) => b.batch_number === 'SOON')?.quantity).toBe(1000);
  });
});
