import { createHash } from 'node:crypto';
import { can, type Actor, type Permission } from '@agripos/shared';
import type { Connection, Database } from '../database/db';
import { assert } from '../utils/errors';
export function requirePermission(actor: Actor, permission: Permission) {
  assert(
    can(actor.role, permission),
    403,
    'FORBIDDEN',
    'You do not have permission for this action',
  );
}
export async function audit(
  tx: Connection,
  actor: Actor,
  action: string,
  entityId: string,
  detail: unknown = {},
) {
  await tx.query(
    'INSERT INTO audit_logs(shop_id,actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4,$5)',
    [actor.shopId, actor.id, action, entityId, JSON.stringify(detail)],
  );
}
export async function command<T>(
  db: Database,
  actor: Actor,
  operationId: string,
  kind: string,
  payload: unknown,
  run: (tx: Connection) => Promise<T>,
): Promise<T> {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return db.transaction(async (tx) => {
    // Serialize shop commands: simple, deterministic lock ordering; row locks remain explicit.
    await tx.query('SELECT id FROM shops WHERE id=$1 FOR UPDATE', [actor.shopId]);
    const prior = (
      await tx.query<{ kind: string; payload_hash: string; result: T }>(
        'SELECT kind,payload_hash,result FROM operations WHERE shop_id=$1 AND id=$2',
        [actor.shopId, operationId],
      )
    )[0];
    if (prior) {
      assert(
        prior.kind === kind && prior.payload_hash === hash,
        409,
        'IDEMPOTENCY_CONFLICT',
        'Operation ID was already used for a different request',
      );
      return prior.result;
    }
    const result = await run(tx);
    await tx.query(
      'INSERT INTO operations(shop_id,id,kind,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
      [actor.shopId, operationId, kind, hash, JSON.stringify(result)],
    );
    return result;
  });
}
