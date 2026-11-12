import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { type Actor } from '@agripos/shared';
import { testDatabase } from './database';
import type { Database } from '../src/database/db';
import { importProducts } from '../src/modules/catalog/import';
import { saveProduct } from '../src/modules/catalog/service';
import { createPurchase, receivePurchase } from '../src/modules/inventory/service';
import { returnToSupplier } from '../src/modules/inventory/supplier-returns';
import { notifications } from '../src/modules/reporting/notifications';
import { inviteStaff } from '../src/modules/staff/service';
import { productImage } from '../src/modules/catalog/images';
let db: Database, categoryId: string, productId: string;
const actor: Actor = {
  id: randomUUID(),
  shopId: randomUUID(),
  name: 'Catalog test',
  role: 'administrator',
};
beforeAll(async () => {
  db = await testDatabase();
  await db.query("INSERT INTO shops(id,name) VALUES($1,'Catalog test')", [actor.shopId]);
  await db.query('INSERT INTO staff(id,shop_id,name,role) VALUES($1,$2,$3,$4)', [
    actor.id,
    actor.shopId,
    actor.name,
    actor.role,
  ]);
  categoryId = (
    await db.query<{ id: string }>(
      "INSERT INTO categories(shop_id,name,kind) VALUES($1,'Fertilizer','fertilizer') RETURNING id",
      [actor.shopId],
    )
  )[0]!.id;
});
afterAll(async () => {
  await db?.close();
});
it('imports validated CSV once and rolls back the whole file on a duplicate', async () => {
  const header = 'name,sku,category,selling_price,purchase_price',
    input = { operationId: randomUUID(), csv: `${header}\nGrow,GROW,Fertilizer,100.00,50.00` };
  expect(await importProducts(db, actor, input)).toEqual({ imported: 1 });
  expect(await importProducts(db, actor, input)).toEqual({ imported: 1 });
  await expect(
    importProducts(db, actor, {
      operationId: randomUUID(),
      csv: `${header}\nOther,OTHER,Fertilizer,100,50\nDuplicate,GROW,Fertilizer,100,50`,
    }),
  ).rejects.toThrow();
  expect(await db.query("SELECT id FROM products WHERE sku='OTHER'")).toHaveLength(0);
});
it('converts purchase units exactly and supplier returns reduce stock and liabilities once', async () => {
  const p = {
    name: 'Bulk feed',
    sku: 'BULK',
    categoryId,
    unit: 'kg',
    purchaseUnit: 'bag',
    purchaseFactor: 50000,
    sellingPrice: 10000,
    purchasePrice: 5000,
  };
  productId = String((await saveProduct(db, actor, p)).id);
  const supplierId = (
    await db.query<{ id: string }>(
      "INSERT INTO suppliers(shop_id,name) VALUES($1,'Feed supplier') RETURNING id",
      [actor.shopId],
    )
  )[0]!.id;
  const order = await createPurchase(db, actor, {
    supplierId,
    lines: [{ productId, quantity: 2000, unitCost: 250000, unit: 'purchase' }],
  });
  const line = (
    await db.query<{ id: string; quantity: number; unit_cost: number }>(
      'SELECT * FROM purchase_lines WHERE purchase_id=$1',
      [order.id],
    )
  )[0]!;
  expect(line.quantity).toBe(100000);
  expect(line.unit_cost).toBe(5000);
  await receivePurchase(db, actor, String(order.id), {
    operationId: randomUUID(),
    lines: [{ lineId: line.id, quantity: 100000, batchNumber: 'FEED' }],
  });
  const batch = (
    await db.query<{ id: string }>('SELECT id FROM batches WHERE product_id=$1', [productId])
  )[0]!;
  const payload = {
    operationId: randomUUID(),
    batchId: batch.id,
    quantity: 10000,
    reason: 'Supplier accepted damaged bag',
  };
  expect((await returnToSupplier(db, actor, payload)).creditAmount).toBe(50000);
  await returnToSupplier(db, actor, payload);
  expect(
    (
      await db.query<{ quantity: number }>('SELECT quantity FROM batches WHERE id=$1', [batch.id])
    )[0]!.quantity,
  ).toBe(90000);
  expect(
    (
      await db.query<{ amount: number }>(
        'SELECT SUM(amount)::bigint amount FROM supplier_ledger WHERE supplier_id=$1',
        [supplierId],
      )
    )[0]!.amount,
  ).toBe(450000);
  await expect(saveProduct(db, actor, { ...p, unit: 'g' }, productId)).rejects.toThrow('base unit');
});
it('deduplicates daily notifications and keeps read state scoped to staff', async () => {
  const first = await notifications(db, actor);
  expect(first.length).toBeGreaterThan(0);
  await notifications(db, actor);
  expect(await db.query('SELECT id FROM notifications WHERE staff_id=$1', [actor.id])).toHaveLength(
    first.length,
  );
});
it('creates local staff credentials and stores only local image markers in PostgreSQL', async () => {
  const membership = await inviteStaff(db, actor, {
    name: 'Employee',
    username: 'employee',
    password: 'test-password-1234',
    role: 'cashier',
  });
  const row = (
    await db.query<{ username: string; password_hash: string }>(
      'SELECT username,password_hash FROM staff WHERE id=$1',
      [membership.id],
    )
  )[0]!;
  expect(row.username).toBe('employee');
  expect(row.password_hash).not.toContain('test-password-1234');
  await expect(
    inviteStaff(
      db,
      { ...actor, role: 'manager' },
      { name: 'Other', username: 'other', password: 'test-password-1234', role: 'cashier' },
    ),
  ).rejects.toThrow('permission');
  await expect(productImage(db, actor, productId, { png: 'not-local' })).rejects.toThrow('desktop');
  await productImage(db, actor, productId, { local: true });
  await productImage(db, actor, 'logo', { local: true });
  expect(await productImage(db, actor, productId)).toEqual({ dataUrl: null });
  expect(await db.query('SELECT path FROM image_objects')).toHaveLength(0);
});
