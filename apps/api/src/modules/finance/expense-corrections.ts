import { z } from 'zod';
import { id, text, expenseSchema, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { command, audit, requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
import { cashMovement } from './cash';
import { expense } from './service';
const schema = z
  .object({ operationId: id, reason: text, expense: expenseSchema.omit({ operationId: true }) })
  .strict();
export async function correctExpense(
  db: Database,
  actor: Actor,
  expenseId: string,
  input: unknown,
) {
  requirePermission(actor, 'expenses.write');
  const p = schema.parse(input);
  return command(db, actor, p.operationId, 'expense.correct', { expenseId, ...p }, async (tx) => {
    const original = (
      await tx.query<{ amount: number; paid_from: string; voided_at: unknown }>(
        'SELECT * FROM expenses WHERE shop_id=$1 AND id=$2 FOR UPDATE',
        [actor.shopId, expenseId],
      )
    )[0];
    assert(
      original && !original.voided_at,
      409,
      'EXPENSE_STATE',
      'Expense was not found or has already been corrected',
    );
    if (original.paid_from === 'cash')
      await cashMovement(
        tx,
        actor,
        p.expense.terminalId,
        original.amount,
        'expense',
        p.operationId,
        `Correction: ${p.reason}`,
      );
    await tx.query('UPDATE expenses SET voided_at=now(),void_reason=$2 WHERE id=$1', [
      expenseId,
      p.reason,
    ]);
    // Nested command uses a distinct internal ID; the outer command is the public retry boundary.
    const replacementId = crypto.randomUUID();
    const nested: Database = {
      query: tx.query,
      transaction: (fn) => fn(tx),
      close: async () => {},
    };
    await expense(nested, actor, { ...p.expense, operationId: replacementId });
    await audit(tx, actor, 'expense.correct', expenseId, { replacementId, reason: p.reason });
    return { id: replacementId, correctedId: expenseId };
  });
}
