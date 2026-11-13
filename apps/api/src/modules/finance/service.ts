import { repaymentSchema, expenseSchema, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { audit, command, requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
import { cashMovement } from './cash';
import { openInstallments, planAllocation } from '../credit/service';
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
    const installments = await openInstallments(tx, actor, customerId);
    assert(
      installments.reduce((s, i) => s + i.remaining, 0) === balance,
      409,
      'LEDGER_REVIEW',
      'Invoice balances require reconciliation before recording this payment',
    );
    const plan = planAllocation(installments, p.payment.amount, p.allocations);
    await tx.query(
      "INSERT INTO customer_ledger(id,shop_id,customer_id,amount,type,reference,actor_id,method,notes) VALUES($1,$2,$3,$4,'repayment',$5,$6,$7,$8)",
      [
        p.operationId,
        actor.shopId,
        customerId,
        -p.payment.amount,
        `${p.payment.method}: ${p.payment.reference}`,
        actor.id,
        p.payment.method,
        p.notes ?? '',
      ],
    );
    const bySale = new Map<string, number>();
    for (const a of plan) bySale.set(a.saleId, (bySale.get(a.saleId) ?? 0) + a.amount);
    for (const [saleId, amount] of bySale)
      await tx.query(
        'INSERT INTO repayment_allocations(shop_id,ledger_id,sale_id,amount) VALUES($1,$2,$3,$4)',
        [actor.shopId, p.operationId, saleId, amount],
      );
    for (const a of plan)
      await tx.query(
        'INSERT INTO installment_allocations(shop_id,ledger_id,installment_id,amount) VALUES($1,$2,$3,$4)',
        [actor.shopId, p.operationId, a.installmentId, a.amount],
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
    return { id: p.operationId, balance: balance - p.payment.amount, allocations: plan };
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
