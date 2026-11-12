import { can, cashOpenSchema, cashCloseSchema, cashMoveSchema, type Actor } from '@agripos/shared';
import type { Connection, Database } from '../../database/db';
import { assert } from '../../utils/errors';
import { command, audit, requirePermission } from '../../services/transactions';
export async function cashMovement(
  tx: Connection,
  actor: Actor,
  terminalId: string | undefined,
  amount: number,
  type: string,
  referenceId: string,
  reason: string,
) {
  if (amount === 0) return;
  const shop = (
    await tx.query<{ require_cash_session: boolean }>(
      'SELECT require_cash_session FROM shops WHERE id=$1',
      [actor.shopId],
    )
  )[0]!;
  const session = terminalId
    ? (
        await tx.query<{ id: string; opened_by: string }>(
          'SELECT id,opened_by FROM cash_sessions WHERE shop_id=$1 AND terminal_id=$2 AND closed_at IS NULL FOR UPDATE',
          [actor.shopId, terminalId],
        )
      )[0]
    : undefined;
  assert(
    session || !shop.require_cash_session,
    409,
    'CASH_SESSION_REQUIRED',
    'Open a cash register session before recording cash',
  );
  if (!session) return;
  assert(
    session.opened_by === actor.id || can(actor.role, 'reports.read'),
    403,
    'REGISTER_OWNER',
    'This register belongs to another employee',
  );
  await tx.query(
    'INSERT INTO cash_movements(shop_id,session_id,amount,type,reference_id,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [actor.shopId, session.id, amount, type, referenceId, reason, actor.id],
  );
}
export async function openCash(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'sales.write');
  const p = cashOpenSchema.parse(input);
  return command(db, actor, p.operationId, 'cash.open', p, async (tx) => {
    const open = (
      await tx.query(
        'SELECT id FROM cash_sessions WHERE shop_id=$1 AND terminal_id=$2 AND closed_at IS NULL',
        [actor.shopId, p.terminalId],
      )
    )[0];
    assert(!open, 409, 'REGISTER_OPEN', 'This terminal already has an open cash session');
    const session = (
      await tx.query(
        'INSERT INTO cash_sessions(id,shop_id,terminal_id,opened_by,opening_float) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [p.operationId, actor.shopId, p.terminalId, actor.id, p.openingFloat],
      )
    )[0];
    await audit(tx, actor, 'cash.open', p.operationId, p);
    return session;
  });
}
export async function closeCash(db: Database, actor: Actor, sessionId: string, input: unknown) {
  requirePermission(actor, 'sales.write');
  const p = cashCloseSchema.parse(input);
  return command(db, actor, p.operationId, 'cash.close', { sessionId, ...p }, async (tx) => {
    const session = (
      await tx.query<{ id: string; opened_by: string; opening_float: number; closed_at: unknown }>(
        'SELECT * FROM cash_sessions WHERE shop_id=$1 AND id=$2 FOR UPDATE',
        [actor.shopId, sessionId],
      )
    )[0];
    assert(session, 404, 'NOT_FOUND', 'Cash session not found');
    assert(!session.closed_at, 409, 'REGISTER_CLOSED', 'Cash session is already closed');
    assert(
      session.opened_by === actor.id || can(actor.role, 'reports.read'),
      403,
      'REGISTER_OWNER',
      'Only the cashier or manager can close this register',
    );
    const moved = (
      await tx.query<{ amount: number }>(
        'SELECT COALESCE(SUM(amount),0)::bigint amount FROM cash_movements WHERE session_id=$1',
        [sessionId],
      )
    )[0]!.amount;
    const expected = session.opening_float + moved;
    const result = (
      await tx.query(
        'UPDATE cash_sessions SET closed_at=now(),closed_by=$2,expected_close=$3::bigint,actual_close=$4::bigint,difference=$4::bigint-$3::bigint WHERE id=$1 RETURNING *',
        [sessionId, actor.id, expected, p.actualClose],
      )
    )[0];
    await audit(tx, actor, 'cash.close', sessionId, {
      expected,
      actual: p.actualClose,
      difference: p.actualClose - expected,
    });
    return result;
  });
}
export async function moveCash(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'expenses.write');
  const p = cashMoveSchema.parse(input);
  return command(db, actor, p.operationId, 'cash.move', p, async (tx) => {
    const session = (
      await tx.query<{ terminal_id: string }>(
        'SELECT terminal_id FROM cash_sessions WHERE shop_id=$1 AND id=$2 AND closed_at IS NULL',
        [actor.shopId, p.sessionId],
      )
    )[0];
    assert(session, 409, 'REGISTER_CLOSED', 'Select an open cash session');
    await cashMovement(
      tx,
      actor,
      session.terminal_id,
      p.amount * (p.direction === 'in' ? 1 : -1),
      p.direction === 'in' ? 'cash_in' : 'cash_out',
      p.operationId,
      p.reason,
    );
    await audit(tx, actor, 'cash.move', p.sessionId, p);
    return { id: p.operationId };
  });
}
