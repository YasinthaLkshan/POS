import { z } from 'zod';
import { id, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { command, requirePermission, audit } from '../../services/transactions';
import { assert } from '../../utils/errors';
const schema = z
  .object({ operationId: id, status: z.enum(['submitted', 'approved', 'sent', 'cancelled']) })
  .strict();
export async function orderStatus(db: Database, actor: Actor, orderId: string, input: unknown) {
  requirePermission(actor, 'purchases.write');
  const p = schema.parse(input);
  if (p.status === 'approved') requirePermission(actor, 'price.write');
  return command(db, actor, p.operationId, 'purchase.status', { orderId, ...p }, async (tx) => {
    const order = (
      await tx.query<{ status: string }>(
        'SELECT status FROM purchases WHERE shop_id=$1 AND id=$2 FOR UPDATE',
        [actor.shopId, orderId],
      )
    )[0];
    assert(order, 404, 'NOT_FOUND', 'Purchase not found');
    const allowed: Record<string, string[]> = {
      draft: ['submitted', 'cancelled'],
      submitted: ['approved', 'cancelled'],
      approved: ['sent', 'cancelled'],
      ordered: ['sent', 'cancelled'],
      sent: ['cancelled'],
    };
    assert(
      allowed[order.status]?.includes(p.status),
      409,
      'ORDER_STATE',
      'This purchase cannot move to the requested status',
    );
    await tx.query('UPDATE purchases SET status=$2 WHERE id=$1', [orderId, p.status]);
    await audit(tx, actor, 'purchase.status', orderId, p);
    return { id: orderId, status: p.status };
  });
}
