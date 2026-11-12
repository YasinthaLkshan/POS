import { stocktakeSchema, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { command, audit, requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
export async function stocktake(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'inventory.write');
  const p = stocktakeSchema.parse(input);
  assert(
    new Set(p.lines.map((l) => l.batchId)).size === p.lines.length,
    422,
    'DUPLICATE_BATCH',
    'Count each batch once',
  );
  return command(db, actor, p.operationId, 'stocktake', p, async (tx) => {
    await tx.query('INSERT INTO stocktakes(id,shop_id,reason,actor_id) VALUES($1,$2,$3,$4)', [
      p.operationId,
      actor.shopId,
      p.reason,
      actor.id,
    ]);
    for (const line of [...p.lines].sort((a, b) => a.batchId.localeCompare(b.batchId))) {
      const batch = (
        await tx.query<{ quantity: number }>(
          'SELECT quantity FROM batches WHERE shop_id=$1 AND id=$2 FOR UPDATE',
          [actor.shopId, line.batchId],
        )
      )[0];
      assert(batch, 404, 'NOT_FOUND', 'Batch not found');
      assert(
        batch.quantity === line.expectedQuantity,
        409,
        'STOCK_CHANGED',
        'Stock changed after this count started. Refresh and recount before posting',
      );
      const delta = line.countedQuantity - line.expectedQuantity;
      if (!delta) continue;
      await tx.query('UPDATE batches SET quantity=$1 WHERE id=$2', [
        line.countedQuantity,
        line.batchId,
      ]);
      await tx.query(
        "INSERT INTO inventory_movements(shop_id,batch_id,delta,type,reason,reference_id,actor_id) VALUES($1,$2,$3,'adjustment',$4,$5,$6)",
        [actor.shopId, line.batchId, delta, `Stocktake: ${p.reason}`, p.operationId, actor.id],
      );
    }
    await audit(tx, actor, 'stocktake.post', p.operationId, p);
    return { id: p.operationId };
  });
}
