import { parkSchema, can, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { command, requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
export async function park(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'sales.write');
  const p = parkSchema.parse(input);
  return command(db, actor, p.operationId, 'sale.park', p, async (tx) => {
    await tx.query(
      'INSERT INTO parked_sales(id,shop_id,label,cart,created_by) VALUES($1,$2,$3,$4,$5)',
      [
        p.operationId,
        actor.shopId,
        p.label,
        JSON.stringify({
          customerId: p.customerId,
          lines: p.lines,
          orderDiscount: p.orderDiscount,
        }),
        actor.id,
      ],
    );
    return { id: p.operationId };
  });
}
export async function resume(db: Database, actor: Actor, parkId: string) {
  requirePermission(actor, 'sales.write');
  return db.transaction(async (tx) => {
    const row = (
      await tx.query<{ cart: unknown; status: string; claimed_by: string | null }>(
        'SELECT * FROM parked_sales WHERE shop_id=$1 AND id=$2 FOR UPDATE',
        [actor.shopId, parkId],
      )
    )[0];
    assert(row, 404, 'NOT_FOUND', 'Parked sale not found');
    assert(
      row.status === 'parked' || (row.status === 'resumed' && row.claimed_by === actor.id),
      409,
      'CART_CLAIMED',
      'This cart was resumed by another employee or completed',
    );
    await tx.query(
      "UPDATE parked_sales SET status='resumed',claimed_by=$2,updated_at=now() WHERE id=$1",
      [parkId, actor.id],
    );
    return row.cart;
  });
}
export async function releasePark(
  db: Database,
  actor: Actor,
  parkId: string,
  input: unknown,
  cancel = false,
) {
  requirePermission(actor, 'sales.write');
  const p = parkSchema.parse(input);
  return command(
    db,
    actor,
    p.operationId,
    cancel ? 'sale.park.cancel' : 'sale.park.release',
    { parkId, ...p },
    async (tx) => {
      const row = (
        await tx.query<{ status: string; claimed_by: string | null; created_by: string }>(
          'SELECT * FROM parked_sales WHERE shop_id=$1 AND id=$2 FOR UPDATE',
          [actor.shopId, parkId],
        )
      )[0];
      assert(
        row && ['parked', 'resumed'].includes(row.status),
        409,
        'CART_STATE',
        'Parked cart is unavailable',
      );
      assert(
        row.claimed_by === actor.id ||
          (!row.claimed_by && row.created_by === actor.id) ||
          can(actor.role, 'refund.write'),
        403,
        'CART_OWNER',
        'Only the cart owner or manager can change it',
      );
      await tx.query(
        'UPDATE parked_sales SET status=$2,claimed_by=NULL,cart=$3,updated_at=now() WHERE id=$1',
        [
          parkId,
          cancel ? 'cancelled' : 'parked',
          JSON.stringify({
            customerId: p.customerId,
            lines: p.lines,
            orderDiscount: p.orderDiscount,
          }),
        ],
      );
      return { id: parkId };
    },
  );
}
