import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Actor } from '@agripos/shared';
import type { Database } from '../src/database/db';
import { testDatabase } from './database';
import { createApp } from '../src/app';
let db: Database,
  app: ReturnType<typeof createApp>,
  productId: string,
  supplierId: string,
  batchId: string,
  sessionId: string;
const terminalId = randomUUID(),
  actor: Actor = {
    id: randomUUID(),
    shopId: randomUUID(),
    name: 'Business test',
    role: 'administrator',
  };
const cashier: Actor = { ...actor, id: randomUUID(), role: 'cashier' };
const post = (path: string, body: object, token = 'admin') =>
  request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body);
const get = (path: string) =>
  request(app).get(`/api/v1${path}`).set('Authorization', 'Bearer admin');
beforeAll(async () => {
  db = await testDatabase();
  await db.query("INSERT INTO shops(id,name) VALUES($1,'Test')", [actor.shopId]);
  for (const a of [actor, cashier])
    await db.query('INSERT INTO staff(id,shop_id,name,role) VALUES($1,$2,$3,$4)', [
      a.id,
      a.shopId,
      a.name,
      a.role,
    ]);
  app = createApp(db, async (token) => (token === 'admin' ? actor : cashier));
  const categoryId = (await post('/categories', { name: 'Tools' })).body.data.id;
  supplierId = (await post('/suppliers', { name: 'Tool supplier' })).body.data.id;
  productId = (
    await post('/products', {
      name: 'Hand tool',
      sku: 'TOOL',
      categoryId,
      sellingPrice: 10000,
      purchasePrice: 5000,
    })
  ).body.data.id;
  const order = (
    await post('/purchases', {
      supplierId,
      lines: [{ productId, quantity: 10000, unitCost: 5000 }],
    })
  ).body.data.id;
  const lineId = (await get(`/purchases/${order}`)).body.data.lines[0].id;
  expect(
    (
      await post(`/purchases/${order}/receive`, {
        operationId: randomUUID(),
        lines: [{ lineId, quantity: 10000, batchNumber: 'TOOLS-1' }],
      })
    ).status,
  ).toBe(200);
  batchId = (await get('/inventory')).body.data[0].id;
});
afterAll(async () => {
  await db?.close();
});
it('requires approval before receiving a draft and rejects invalid order transitions', async () => {
  const created = await post('/purchases', {
    supplierId,
    status: 'draft',
    lines: [{ productId, quantity: 1000, unitCost: 5000 }],
  });
  expect(created.status, created.text).toBe(201);
  const orderId = created.body.data.id;
  const lineId = (await get(`/purchases/${orderId}`)).body.data.lines[0].id;
  const receive = {
    operationId: randomUUID(),
    lines: [{ lineId, quantity: 1000, batchNumber: 'DRAFT' }],
  };
  expect((await post(`/purchases/${orderId}/receive`, receive)).status).toBe(409);
  expect(
    (await post(`/purchases/${orderId}/status`, { operationId: randomUUID(), status: 'approved' }))
      .status,
  ).toBe(409);
  expect(
    (await post(`/purchases/${orderId}/status`, { operationId: randomUUID(), status: 'submitted' }))
      .status,
  ).toBe(200);
  expect(
    (
      await post(
        `/purchases/${orderId}/status`,
        { operationId: randomUUID(), status: 'approved' },
        'cashier',
      )
    ).status,
  ).toBe(403);
  const approval = { operationId: randomUUID(), status: 'approved' };
  expect((await post(`/purchases/${orderId}/status`, approval)).status).toBe(200);
  expect((await post(`/purchases/${orderId}/status`, approval)).status).toBe(200);
  expect(
    (await post(`/purchases/${orderId}/status`, { operationId: randomUUID(), status: 'cancelled' }))
      .status,
  ).toBe(200);
  expect((await post(`/purchases/${orderId}/receive`, receive)).status).toBe(409);
});
it('corrects an expense once and preserves the original audit record', async () => {
  const original = {
    operationId: randomUUID(),
    category: 'Transport',
    description: 'Bank charge',
    amount: 1500,
    date: '2026-11-10',
    paidFrom: 'bank',
  };
  expect((await post('/expenses', original)).status).toBe(201);
  const correction = {
    operationId: randomUUID(),
    reason: 'Receipt amount corrected',
    expense: {
      category: 'Transport',
      description: 'Bank charge corrected',
      amount: 1000,
      date: '2026-11-10',
      paidFrom: 'bank',
    },
  };
  const result = await post(`/expenses/${original.operationId}/correct`, correction);
  expect(result.status, result.text).toBe(200);
  expect((await post(`/expenses/${original.operationId}/correct`, correction)).body.data.id).toBe(
    result.body.data.id,
  );
  expect(
    (
      await post(`/expenses/${original.operationId}/correct`, {
        ...correction,
        operationId: randomUUID(),
      })
    ).status,
  ).toBe(409);
  const rows = await db.query<{ amount: number; voided_at: unknown }>(
    'SELECT amount,voided_at FROM expenses WHERE id=$1 OR id=$2 ORDER BY amount',
    [original.operationId, result.body.data.id],
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]?.voided_at).toBeNull();
  expect(rows[1]?.voided_at).toBeTruthy();
});
it('tracks supplier liabilities on receiving and prevents payment over-allocation', async () => {
  expect((await get('/suppliers')).body.data[0].balance).toBe(50000);
  const payment = {
    operationId: randomUUID(),
    supplierId,
    payment: { method: 'transfer', amount: 20000, reference: 'BANK-VERIFIED' },
  };
  expect((await post('/supplier-payments', payment)).body.data.balance).toBe(30000);
  expect((await post('/supplier-payments', payment)).body.data.balance).toBe(30000);
  expect(
    (
      await post('/supplier-payments', {
        ...payment,
        operationId: randomUUID(),
        payment: { ...payment.payment, amount: 30001 },
      })
    ).status,
  ).toBe(409);
  expect((await get(`/suppliers/${supplierId}/ledger`)).body.data).toHaveLength(2);
});
it('opens one register per terminal and posts cash sales atomically', async () => {
  const opening = { operationId: randomUUID(), terminalId, openingFloat: 100000 };
  const response = await post('/cash-sessions/open', opening);
  expect(response.status, response.text).toBe(201);
  sessionId = response.body.data.id;
  expect((await post('/cash-sessions/open', opening)).body.data.id).toBe(sessionId);
  expect(
    (await post('/cash-sessions/open', { ...opening, operationId: randomUUID() })).status,
  ).toBe(409);
  expect(
    (
      await post('/sales', {
        operationId: randomUUID(),
        terminalId,
        lines: [{ productId, quantity: 2000 }],
        payments: [{ method: 'cash', amount: 20000 }],
      })
    ).status,
  ).toBe(201);
  expect((await get('/cash-sessions')).body.data[0].movements).toBe(20000);
});
it('reconciles expenses and cash out, retaining the counted difference', async () => {
  expect(
    (
      await post('/expenses', {
        operationId: randomUUID(),
        category: 'Transport',
        description: 'Delivery',
        amount: 1500,
        date: '2026-11-10',
        paidFrom: 'cash',
        terminalId,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await post('/cash-sessions/movements', {
        operationId: randomUUID(),
        sessionId,
        direction: 'out',
        amount: 1000,
        reason: 'Petty cash withdrawal',
      })
    ).status,
  ).toBe(201);
  const payload = { operationId: randomUUID(), actualClose: 117000 };
  const result = await post(`/cash-sessions/${sessionId}/close`, payload);
  expect(result.status, result.text).toBe(200);
  expect(result.body.data.expected_close).toBe(117500);
  expect(result.body.data.difference).toBe(-500);
  expect((await post(`/cash-sessions/${sessionId}/close`, payload)).status).toBe(200);
  expect(
    (await post(`/cash-sessions/${sessionId}/close`, { ...payload, operationId: randomUUID() }))
      .status,
  ).toBe(409);
  await expect(db.query('DELETE FROM cash_movements')).rejects.toThrow('immutable');
});
it('rejects stale stocktakes and posts counted deltas once', async () => {
  const count = {
    operationId: randomUUID(),
    reason: 'Cycle count',
    lines: [{ batchId, expectedQuantity: 8000, countedQuantity: 9000 }],
  };
  expect((await post('/inventory/stocktakes', count)).status).toBe(201);
  expect((await post('/inventory/stocktakes', count)).status).toBe(201);
  expect(
    (await post('/inventory/stocktakes', { ...count, operationId: randomUUID() })).status,
  ).toBe(409);
  expect((await get('/inventory')).body.data[0].quantity).toBe(9000);
});
it('parks without stock changes and allows only the claimant to resume and complete', async () => {
  const parkId = randomUUID();
  const payload = {
    operationId: parkId,
    label: 'Farmer A',
    lines: [{ productId, quantity: 1000 }],
  };
  expect((await post('/sales/park', payload)).status).toBe(201);
  expect((await get('/inventory')).body.data[0].quantity).toBe(9000);
  expect((await post(`/sales/park/${parkId}/resume`, {})).status).toBe(200);
  expect((await post(`/sales/park/${parkId}/resume`, {}, 'cashier')).status).toBe(409);
  const sale = {
    operationId: randomUUID(),
    terminalId,
    parkedId: parkId,
    lines: [{ productId, quantity: 1000 }],
    payments: [{ method: 'transfer', amount: 10000, reference: 'CONFIRMED' }],
  };
  expect((await post('/sales', sale)).status).toBe(201);
  expect((await get('/sales/park')).body.data).toHaveLength(0);
  expect((await post('/sales', { ...sale, operationId: randomUUID() })).status).toBe(409);
});
it('enforces configured mandatory register sessions and rolls back failed cash checkout', async () => {
  await db.query('UPDATE shops SET require_cash_session=true WHERE id=$1', [actor.shopId]);
  const before = (await get('/inventory')).body.data[0].quantity;
  const result = await post('/sales', {
    operationId: randomUUID(),
    terminalId,
    lines: [{ productId, quantity: 1000 }],
    payments: [{ method: 'cash', amount: 10000 }],
  });
  expect(result.status).toBe(409);
  expect(result.body.error.code).toBe('CASH_SESSION_REQUIRED');
  expect((await get('/inventory')).body.data[0].quantity).toBe(before);
});
it('pages historical records without repeating the first group', async () => {
  for (const endpoint of ['/purchases', '/expenses']) {
    const first = await get(`${endpoint}?limit=1&page=1`);
    const second = await get(`${endpoint}?limit=1&page=2`);
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    expect((await get(`${endpoint}?limit=101&page=1`)).status).toBe(422);
  }
});
it('allows staff to edit only their own display name, not their role', async () => {
  const changed = await request(app)
    .patch('/api/v1/auth/me')
    .set('Authorization', 'Bearer cashier')
    .send({ name: 'Updated cashier' });
  expect(changed.status, changed.text).toBe(200);
  expect(changed.body.data.role).toBe('cashier');
  expect(
    (await db.query<{ name: string }>('SELECT name FROM staff WHERE id=$1', [cashier.id]))[0]?.name,
  ).toBe('Updated cashier');
  const escalation = await request(app)
    .patch('/api/v1/auth/me')
    .set('Authorization', 'Bearer cashier')
    .send({ name: 'Updated cashier', role: 'administrator' });
  expect(escalation.status).toBe(422);
});
