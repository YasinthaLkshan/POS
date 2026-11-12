import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { type Actor, type OfflineGrant, type OfflineOperation, saleSchema } from '@agripos/shared';
import { testDatabase } from './database';
import type { Database } from '../src/database/db';
import { provisionOffline, pushOffline } from '../src/modules/sync/service';
import { createSale } from '../src/modules/sales/service';
let db: Database, grant: OfflineGrant;
const actor: Actor = {
    id: randomUUID(),
    shopId: randomUUID(),
    name: 'Offline cashier',
    role: 'administrator',
  },
  terminalId = randomUUID(),
  productId = randomUUID(),
  batchId = randomUUID();
beforeAll(async () => {
  db = await testDatabase();
  await db.query("INSERT INTO shops(id,name) VALUES($1,'Offline test')", [actor.shopId]);
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
    "INSERT INTO products(id,shop_id,category_id,name,sku,unit,purchase_price,selling_price) VALUES($1,$2,$3,'Tool','OFF','piece',5000,10000)",
    [productId, actor.shopId, category],
  );
  await db.query(
    "INSERT INTO batches(id,shop_id,product_id,batch_number,quantity,unit_cost) VALUES($1,$2,$3,'OFF-1',10000,5000)",
    [batchId, actor.shopId, productId],
  );
  await db.query(
    "INSERT INTO terminals(id,shop_id,name,offline_enabled,authorized_by) VALUES($1,$2,'Till',true,$3)",
    [terminalId, actor.shopId, actor.id],
  );
  grant = await provisionOffline(
    db,
    actor,
    terminalId,
    'test-only-offline-secret-32-characters-long',
  );
});
afterAll(async () => {
  await db?.close();
});
const operation = (quantity = 1000): OfflineOperation => ({
  grantId: grant.id,
  grantToken: grant.token,
  createdAt: new Date().toISOString(),
  sale: saleSchema.parse({
    operationId: randomUUID(),
    terminalId,
    lines: [{ productId, quantity }],
    payments: [{ method: 'cash', amount: quantity * 10 }],
  }),
  allocations: [{ batchId, productId, quantity }],
});
it('accepts signed snapshot prices and retries without duplicate stock or receipts', async () => {
  await db.query('UPDATE products SET selling_price=15000 WHERE id=$1', [productId]);
  const receipt = operation(),
    result = await pushOffline(db, actor, receipt);
  expect(result.state, result.message).toBe('synced');
  expect((await pushOffline(db, actor, receipt)).state).toBe('synced');
  expect(
    (
      await db.query<{ total: number }>('SELECT total FROM sales WHERE id=$1', [
        receipt.sale.operationId,
      ])
    )[0]!.total,
  ).toBe(10000);
  expect(
    (
      await db.query<{ quantity: number }>('SELECT quantity FROM batches WHERE id=$1', [batchId])
    )[0]!.quantity,
  ).toBe(9000);
});
it('rejects forged authorization and mismatched immutable receipt IDs', async () => {
  const receipt = operation();
  await expect(pushOffline(db, actor, { ...receipt, grantToken: 'forged' })).rejects.toThrow(
    'invalid',
  );
  expect((await pushOffline(db, actor, receipt)).state).toBe('synced');
  await expect(
    pushOffline(db, actor, { ...receipt, createdAt: new Date(Date.now() + 1000).toISOString() }),
  ).rejects.toThrow('different receipt');
});
it('retains oversold offline receipts for reconciliation and accepts them once stock is corrected', async () => {
  await createSale(db, actor, {
    operationId: randomUUID(),
    terminalId,
    lines: [{ productId, quantity: 8000 }],
    payments: [{ method: 'cash', amount: 120000 }],
  });
  const receipt = operation(2000),
    result = await pushOffline(db, actor, receipt);
  expect(result.state).toBe('conflict');
  expect(
    await db.query("SELECT id FROM sync_operations WHERE id=$1 AND state='conflict'", [
      receipt.sale.operationId,
    ]),
  ).toHaveLength(1);
  await db.query('UPDATE batches SET quantity=2000 WHERE id=$1', [batchId]);
  expect((await pushOffline(db, actor, receipt)).state).toBe('synced');
});
it('preserves expired and restricted receipts as visible conflicts', async () => {
  const receipt = operation();
  receipt.createdAt = new Date(Date.parse(grant.expiresAt) + 1000).toISOString();
  expect((await pushOffline(db, actor, receipt)).state).toBe('conflict');
  const discounted = operation();
  discounted.sale.lines[0]!.discount = 1;
  expect((await pushOffline(db, actor, discounted)).state).toBe('conflict');
});
it('enforces aggregate batch allowance across accepted receipts', async () => {
  await db.query('UPDATE batches SET quantity=20000 WHERE id=$1', [batchId]);
  const result = await pushOffline(db, actor, operation(7000));
  expect(result.state).toBe('conflict');
  expect(result.message).toContain('allowance');
});
