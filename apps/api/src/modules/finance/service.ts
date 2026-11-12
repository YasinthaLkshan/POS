import { repaymentSchema, expenseSchema, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { audit, command, requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
import { cashMovement } from './cash';
export async function repay(db: Database, actor: Actor, customerId: string, input: unknown) {
  requirePermission(actor, 'payments.write');
  const p = repaymentSchema.parse(input);
  return command(db, actor, p.operationId, 'repayment', { customerId, ...p }, async (tx) => {
    const customer = (
      await tx.query('SELECT id FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE', [
        actor.shopId,
        customerId,
      ])
    )[0];
    assert(customer, 404, 'NOT_FOUND', 'Customer not found');
    const balance = (
      await tx.query<{ balance: number }>(
        'SELECT COALESCE(SUM(amount),0)::bigint balance FROM customer_ledger WHERE shop_id=$1 AND customer_id=$2',
        [actor.shopId, customerId],
      )
    )[0]!.balance;
    assert(
      p.payment.amount <= balance,
      409,
      'OVERPAYMENT',
      'Repayment exceeds outstanding balance',
    );
    await tx.query(
      "INSERT INTO customer_ledger(id,shop_id,customer_id,amount,type,reference,actor_id) VALUES($1,$2,$3,$4,'repayment',$5,$6)",
      [
        p.operationId,
        actor.shopId,
        customerId,
        -p.payment.amount,
        `${p.payment.method}: ${p.payment.reference}`,
        actor.id,
      ],
    );
    let remaining = p.payment.amount;
    const invoices = await tx.query<{ id: string; due: number }>(
      `SELECT s.id,(s.credit-COALESCE((SELECT SUM(a.amount) FROM repayment_allocations a WHERE a.sale_id=s.id),0)-COALESCE((SELECT SUM(r.credit_amount) FROM returns r WHERE r.sale_id=s.id),0))::bigint due FROM sales s WHERE s.shop_id=$1 AND s.customer_id=$2 AND s.credit>0 ORDER BY s.due_date,s.created_at,s.id`,
      [actor.shopId, customerId],
    );
    for (const invoice of invoices) {
      const amount = Math.min(remaining, invoice.due);
      if (amount > 0) {
        await tx.query(
          'INSERT INTO repayment_allocations(shop_id,ledger_id,sale_id,amount) VALUES($1,$2,$3,$4)',
          [actor.shopId, p.operationId, invoice.id, amount],
        );
        remaining -= amount;
      }
      if (!remaining) break;
    }
    assert(
      remaining === 0,
      409,
      'LEDGER_REVIEW',
      'Invoice balances require reconciliation before recording this payment',
    );
    if (p.payment.method === 'cash')
      await cashMovement(
        tx,
        actor,
        p.terminalId,
        p.payment.amount,
        'repayment',
        p.operationId,
        'Customer repayment',
      );
    await audit(tx, actor, 'customer.repayment', customerId, p);
    return { id: p.operationId, balance: balance - p.payment.amount };
  });
}
export async function expense(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'expenses.write');
  const p = expenseSchema.parse(input);
  return command(db, actor, p.operationId, 'expense', p, async (tx) => {
    await tx.query(
      'INSERT INTO expenses(id,shop_id,category,description,amount,date,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [p.operationId, actor.shopId, p.category, p.description, p.amount, p.date, actor.id],
    );
    await tx.query('UPDATE expenses SET paid_from=$2,terminal_id=$3 WHERE id=$1', [
      p.operationId,
      p.paidFrom,
      p.terminalId ?? null,
    ]);
    if (p.paidFrom === 'cash')
      await cashMovement(
        tx,
        actor,
        p.terminalId,
        -p.amount,
        'expense',
        p.operationId,
        p.description,
      );
    await audit(tx, actor, 'expense.create', p.operationId, p);
    return { id: p.operationId };
  });
}
