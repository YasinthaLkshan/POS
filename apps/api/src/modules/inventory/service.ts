import {
  purchaseSchema,
  receiveSchema,
  adjustmentSchema,
  multiply,
  type Actor,
} from '@agripos/shared';
import type { Database } from '../../database/db';
import { randomUUID } from 'node:crypto';
import { audit, command, requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
export async function createPurchase(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'purchases.write');
  const p = purchaseSchema.parse(input);
  assert(
    new Set(p.lines.map((l) => l.productId)).size === p.lines.length,
    422,
    'DUPLICATE_LINE',
    'Combine duplicate product lines',
  );
  if (p.status === 'ordered') requirePermission(actor, 'price.write');
  return command(db, actor, p.operationId ?? randomUUID(), 'purchase.create', p, async (tx) => {
    const supplier = (
      await tx.query<{ active: boolean }>(
        'SELECT active FROM suppliers WHERE shop_id=$1 AND id=$2',
        [actor.shopId, p.supplierId],
      )
    )[0];
    assert(supplier?.active, 409, 'SUPPLIER_INACTIVE', 'Select an active supplier');
    const order = (
      await tx.query(
        'INSERT INTO purchases(shop_id,supplier_id,created_by,status) VALUES($1,$2,$3,$4) RETURNING *',
        [actor.shopId, p.supplierId, actor.id, p.status],
      )
    )[0]!;
    for (const line of p.lines) {
      let baseQuantity = line.quantity,
        baseCost = line.unitCost;
      if (line.unit === 'purchase') {
        const product = (
          await tx.query<{ purchase_factor: number }>(
            'SELECT purchase_factor FROM products WHERE shop_id=$1 AND id=$2',
            [actor.shopId, line.productId],
          )
        )[0];
        assert(product, 404, 'NOT_FOUND', 'Product not found');
        const converted = BigInt(line.quantity) * BigInt(product.purchase_factor);
        assert(
          converted % 1000n === 0n && converted / 1000n <= 1000000000n,
          422,
          'UNIT_PRECISION',
          'Converted quantity must fit three decimal places',
        );
        baseQuantity = Number(converted / 1000n);
        const cost = BigInt(line.unitCost) * 1000n;
        assert(
          cost % BigInt(product.purchase_factor) === 0n,
          422,
          'UNIT_COST_PRECISION',
          'Purchase-unit cost must convert exactly to cents per base unit; enter a base-unit cost instead',
        );
        baseCost = Number(cost / BigInt(product.purchase_factor));
      }
      await tx.query(
        'INSERT INTO purchase_lines(shop_id,purchase_id,product_id,quantity,unit_cost) VALUES($1,$2,$3,$4,$5)',
        [actor.shopId, order.id, line.productId, baseQuantity, baseCost],
      );
    }
    await audit(tx, actor, 'purchase.create', String(order.id));
    return order;
  });
}
export async function receivePurchase(
  db: Database,
  actor: Actor,
  purchaseId: string,
  input: unknown,
) {
  requirePermission(actor, 'inventory.write');
  const p = receiveSchema.parse(input);
  assert(
    new Set(p.lines.map((l) => l.lineId)).size === p.lines.length,
    422,
    'DUPLICATE_LINE',
    'Combine duplicate receipt lines',
  );
  return command(db, actor, p.operationId, 'receive', { purchaseId, ...p }, async (tx) => {
    const order = (
      await tx.query('SELECT * FROM purchases WHERE shop_id=$1 AND id=$2 FOR UPDATE', [
        actor.shopId,
        purchaseId,
      ])
    )[0];
    assert(order, 404, 'NOT_FOUND', 'Purchase not found');
    assert(
      ['ordered', 'approved', 'sent', 'partial'].includes(String(order.status)),
      409,
      'ORDER_NOT_APPROVED',
      'Approve the purchase order before receiving',
    );
    if (p.invoiceNumber !== undefined)
      await tx.query('UPDATE purchases SET invoice_number=$2,due_date=$3 WHERE id=$1', [
        purchaseId,
        p.invoiceNumber,
        p.dueDate ?? null,
      ]);
    for (const received of p.lines) {
      assert(
        !received.manufactureDate ||
          !received.expiryDate ||
          received.manufactureDate <= received.expiryDate,
        422,
        'BATCH_DATES',
        'Manufacture date must precede expiry',
      );
      const line = (
        await tx.query<{
          id: string;
          product_id: string;
          quantity: number;
          received: number;
          unit_cost: number;
        }>(
          'SELECT * FROM purchase_lines WHERE shop_id=$1 AND purchase_id=$2 AND id=$3 FOR UPDATE',
          [actor.shopId, purchaseId, received.lineId],
        )
      )[0];
      assert(line, 404, 'NOT_FOUND', 'Purchase line not found');
      assert(
        received.quantity <= line.quantity - line.received,
        409,
        'OVER_RECEIPT',
        'Received quantity exceeds outstanding order',
      );
      const batch = (
        await tx.query(
          'INSERT INTO batches(shop_id,product_id,batch_number,expiry_date,quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
          [
            actor.shopId,
            line.product_id,
            received.batchNumber,
            received.expiryDate,
            received.quantity,
            line.unit_cost,
          ],
        )
      )[0]!;
      await tx.query(
        'UPDATE batches SET purchase_id=$2,supplier_id=$3,received_quantity=$4,manufacture_date=$5,supplier_lot=$6 WHERE id=$1',
        [
          batch.id,
          purchaseId,
          order.supplier_id,
          received.quantity,
          received.manufactureDate,
          received.supplierLot,
        ],
      );
      await tx.query('UPDATE purchase_lines SET received=received+$1 WHERE id=$2', [
        received.quantity,
        line.id,
      ]);
      await tx.query(
        "INSERT INTO inventory_movements(shop_id,batch_id,delta,type,reason,reference_id,actor_id) VALUES($1,$2,$3,'purchase_receipt','Goods received',$4,$5)",
        [actor.shopId, batch.id, received.quantity, purchaseId, actor.id],
      );
    }
    const pending = (
      await tx.query<{ count: number }>(
        'SELECT COUNT(*)::int count FROM purchase_lines WHERE purchase_id=$1 AND received<quantity',
        [purchaseId],
      )
    )[0]!.count;
    await tx.query('UPDATE purchases SET status=$1 WHERE id=$2', [
      pending ? 'partial' : 'received',
      purchaseId,
    ]);
    let receivedCost = 0;
    for (const received of p.lines) {
      const line = (
        await tx.query<{ unit_cost: number }>('SELECT unit_cost FROM purchase_lines WHERE id=$1', [
          received.lineId,
        ])
      )[0]!;
      receivedCost += multiply(line.unit_cost, received.quantity);
    }
    if (receivedCost > 0)
      await tx.query(
        "INSERT INTO supplier_ledger(shop_id,supplier_id,purchase_id,amount,type,reference_id,actor_id) VALUES($1,$2,$3,$4,'receipt',$5,$6)",
        [actor.shopId, order.supplier_id, purchaseId, receivedCost, p.operationId, actor.id],
      );
    await audit(tx, actor, 'purchase.receive', purchaseId, p);
    return { id: purchaseId, status: pending ? 'partial' : 'received' };
  });
}
export async function adjustStock(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'inventory.write');
  const p = adjustmentSchema.parse(input);
  assert(
    p.type === 'adjustment' || p.delta < 0,
    422,
    'INVALID_ADJUSTMENT',
    'Damage and write-off quantities must reduce stock',
  );
  return command(db, actor, p.operationId, 'adjust', p, async (tx) => {
    const batch = (
      await tx.query<{ quantity: number }>(
        'SELECT quantity FROM batches WHERE shop_id=$1 AND id=$2 FOR UPDATE',
        [actor.shopId, p.batchId],
      )
    )[0];
    assert(batch, 404, 'NOT_FOUND', 'Batch not found');
    assert(
      batch.quantity + p.delta >= 0,
      409,
      'INSUFFICIENT_STOCK',
      'Adjustment would cause negative stock',
    );
    await tx.query('UPDATE batches SET quantity=quantity+$1 WHERE id=$2', [p.delta, p.batchId]);
    await tx.query(
      'INSERT INTO inventory_movements(shop_id,batch_id,delta,type,reason,reference_id,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [actor.shopId, p.batchId, p.delta, p.type, p.reason, p.operationId, actor.id],
    );
    await audit(tx, actor, 'inventory.adjust', p.batchId, p);
    return { id: p.batchId, quantity: batch.quantity + p.delta };
  });
}
