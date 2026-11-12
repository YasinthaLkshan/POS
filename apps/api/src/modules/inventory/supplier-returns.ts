import { z } from 'zod';
import { id, qty, text, multiply, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { command, requirePermission, audit } from '../../services/transactions';
import { assert } from '../../utils/errors';
const schema = z.object({ operationId: id, batchId: id, quantity: qty, reason: text }).strict();
export async function returnToSupplier(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'purchases.write');
  requirePermission(actor, 'inventory.write');
  const p = schema.parse(input);
  return command(db, actor, p.operationId, 'supplier.return', p, async (tx) => {
    const batch = (
      await tx.query<{
        quantity: number;
        unit_cost: number;
        supplier_id: string | null;
        purchase_id: string;
        received_quantity: number | null;
      }>('SELECT * FROM batches WHERE shop_id=$1 AND id=$2 FOR UPDATE', [actor.shopId, p.batchId])
    )[0];
    assert(
      batch?.supplier_id && batch.received_quantity,
      409,
      'SUPPLIER_PROVENANCE',
      'This batch needs a linked purchase receipt before a supplier return',
    );
    const returned = (
      await tx.query<{ quantity: number }>(
        'SELECT COALESCE(SUM(quantity),0)::bigint quantity FROM supplier_returns WHERE batch_id=$1',
        [p.batchId],
      )
    )[0]!.quantity;
    assert(
      p.quantity <= batch.quantity && p.quantity <= batch.received_quantity - returned,
      409,
      'RETURN_QUANTITY',
      'Supplier return exceeds available or originally received stock',
    );
    const receiptCost = multiply(batch.unit_cost, batch.received_quantity),
      amount =
        multiply(receiptCost, returned + p.quantity, batch.received_quantity) -
        multiply(receiptCost, returned, batch.received_quantity);
    await tx.query('UPDATE batches SET quantity=quantity-$1 WHERE id=$2', [p.quantity, p.batchId]);
    await tx.query(
      'INSERT INTO supplier_returns(id,shop_id,batch_id,supplier_id,quantity,credit_amount,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        p.operationId,
        actor.shopId,
        p.batchId,
        batch.supplier_id,
        p.quantity,
        amount,
        p.reason,
        actor.id,
      ],
    );
    await tx.query(
      "INSERT INTO inventory_movements(shop_id,batch_id,delta,type,reason,reference_id,actor_id) VALUES($1,$2,$3,'supplier_return',$4,$5,$6)",
      [actor.shopId, p.batchId, -p.quantity, p.reason, p.operationId, actor.id],
    );
    if (amount)
      await tx.query(
        "INSERT INTO supplier_ledger(shop_id,supplier_id,purchase_id,amount,type,reference_id,actor_id) VALUES($1,$2,$3,$4,'return',$5,$6)",
        [actor.shopId, batch.supplier_id, batch.purchase_id, -amount, p.operationId, actor.id],
      );
    await audit(tx, actor, 'supplier.return', p.batchId, p);
    return { id: p.operationId, creditAmount: amount };
  });
}
