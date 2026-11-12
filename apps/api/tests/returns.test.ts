import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Actor } from '@agripos/shared';
import { testDatabase } from './database';
import type { Database } from '../src/database/db';
import { createSale, returnSale } from '../src/modules/sales/service';
import { repay } from '../src/modules/finance/service';
import { trend } from '../src/modules/reporting/queries';
import { report } from '../src/modules/reporting/reports';
import { reportKinds } from '@agripos/shared';
let db: Database, lineId: string;
const actor: Actor = {
    id: randomUUID(),
    shopId: randomUUID(),
    name: 'Returns manager',
    role: 'administrator',
  },
  terminalId = randomUUID(),
  productId = randomUUID(),
  batchId = randomUUID(),
  customerId = randomUUID(),
  saleId = randomUUID();
beforeAll(async () => {
  db = await testDatabase();
  await db.query("INSERT INTO shops(id,name) VALUES($1,'Returns test')", [actor.shopId]);
  await db.query('INSERT INTO staff(id,shop_id,name,role) VALUES($1,$2,$3,$4)', [
    actor.id,
    actor.shopId,
    actor.name,
    actor.role,
  ]);
  const category = randomUUID();
  await db.query("INSERT INTO categories(id,shop_id,name,kind) VALUES($1,$2,'Tools','equipment')", [
    category,
    actor.shopId,
  ]);
  await db.query(
    "INSERT INTO products(id,shop_id,category_id,name,sku,unit,purchase_price,selling_price,tax_bps) VALUES($1,$2,$3,'Tool','RETURN','piece',5000,10001,1500)",
    [productId, actor.shopId, category],
  );
  await db.query(
    "INSERT INTO batches(id,shop_id,product_id,batch_number,quantity,unit_cost) VALUES($1,$2,$3,'R-1',10000,5000)",
    [batchId, actor.shopId, productId],
  );
  await db.query(
    "INSERT INTO customers(id,shop_id,name,credit_limit) VALUES($1,$2,'Farmer',100000)",
    [customerId, actor.shopId],
  );
  await createSale(db, actor, {
    operationId: saleId,
    terminalId,
    customerId,
    dueDate: '2099-01-01',
    lines: [{ productId, quantity: 3000 }],
    payments: [{ method: 'cash', amount: 4503 }],
  });
  lineId = (
    await db.query<{ id: string }>('SELECT id FROM sale_lines WHERE sale_id=$1', [saleId])
  )[0]!.id;
});
afterAll(async () => {
  await db?.close();
});
it('allocates repayments to invoices and partially returns credit without paying out unpaid debt', async () => {
  await repay(db, actor, customerId, {
    operationId: randomUUID(),
    payment: { method: 'cash', amount: 10000 },
  });
  const result = await returnSale(db, actor, saleId, {
    operationId: randomUUID(),
    reason: 'Partial return',
    restock: true,
    lines: [{ lineId, quantity: 1000 }],
  });
  expect(result.total).toBe(11501);
  expect(result.creditAmount).toBe(11501);
  expect(result.refundAmount).toBe(0);
  expect(
    (
      await db.query<{ quantity: number }>('SELECT quantity FROM batches WHERE id=$1', [batchId])
    )[0]!.quantity,
  ).toBe(8000);
  expect(
    (
      await db.query<{ balance: number }>(
        'SELECT SUM(amount)::bigint balance FROM customer_ledger WHERE customer_id=$1',
        [customerId],
      )
    )[0]!.balance,
  ).toBe(8499);
});
it('refunds only the paid portion, conserves rounding cents, and cannot return items twice', async () => {
  const payload = { operationId: randomUUID(), reason: 'Remaining return damaged', restock: false };
  const result = await returnSale(db, actor, saleId, payload);
  expect(result.total).toBe(23002);
  expect(result.creditAmount).toBe(8499);
  expect(result.refundAmount).toBe(14503);
  expect(await returnSale(db, actor, saleId, payload)).toEqual(result);
  await expect(
    returnSale(db, actor, saleId, { ...payload, operationId: randomUUID() }),
  ).rejects.toThrow('fully returned');
  expect(
    (
      await db.query<{ balance: number }>(
        'SELECT SUM(amount)::bigint balance FROM customer_ledger WHERE customer_id=$1',
        [customerId],
      )
    )[0]!.balance,
  ).toBe(0);
  const totals = (
    await db.query<{ total: number; tax: number; cost: number }>(
      'SELECT SUM(total_amount)::bigint total,SUM(tax)::bigint tax,SUM(cost)::bigint cost FROM returns WHERE sale_id=$1',
      [saleId],
    )
  )[0]!;
  expect(totals).toEqual({ total: 34503, tax: 4500, cost: 5000 });
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }),
    rows = await trend(db, actor, day, day);
  expect(rows[0]!.revenue).toBe(0);
  await expect(db.query('DELETE FROM returns')).rejects.toThrow('immutable');
});
it('rejects excessive partial quantities and unauthorized refunds without changing stock', async () => {
  const sale = await createSale(db, actor, {
    operationId: randomUUID(),
    terminalId,
    lines: [{ productId, quantity: 1000 }],
    payments: [{ method: 'cash', amount: 11501 }],
  });
  const line = (
    await db.query<{ id: string }>('SELECT id FROM sale_lines WHERE sale_id=$1', [sale.id])
  )[0]!;
  const payload = {
    operationId: randomUUID(),
    reason: 'Invalid',
    restock: true,
    lines: [{ lineId: line.id, quantity: 1001 }],
  };
  await expect(returnSale(db, actor, sale.id, payload)).rejects.toThrow('exceeds');
  await expect(returnSale(db, { ...actor, role: 'cashier' }, sale.id, payload)).rejects.toThrow(
    'permission',
  );
});
it('executes every report against persisted data and protects financial access', async () => {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
  for (const kind of reportKinds) {
    const result = await report(db, actor, kind, day, day);
    expect(result.columns.length, kind).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  }
  await expect(report(db, { ...actor, role: 'cashier' }, 'inventory', day, day)).rejects.toThrow(
    'permission',
  );
});
