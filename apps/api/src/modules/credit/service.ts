import { z } from 'zod';
import {
  allocatePayment,
  id,
  installmentStates,
  repaymentPreviewSchema,
  type Actor,
  type Allocation,
} from '@agripos/shared';
import type { Connection, Database } from '../../database/db';
import { requirePermission } from '../../services/transactions';
import { AppError, assert } from '../../utils/errors';
import { installmentRows, statusRank } from './queries';

export interface InstallmentRow extends Record<string, unknown> {
  id: string;
  sale_id: string;
  seq: number;
  due_date: string;
  amount: number;
  paid: number;
  remaining: number;
  invoice_number: string;
  status: string;
}

export async function openInstallments(tx: Connection, actor: Actor, customerId: string) {
  return tx.query<InstallmentRow>(
    `${installmentRows} WHERE ib.shop_id=$1 AND c.id=$2 AND ib.remaining>0 ORDER BY ib.due_date,s.created_at,ib.seq`,
    [actor.shopId, customerId],
  );
}

/** Validated allocation plan; throws a 409 with the business reason when it cannot be applied. */
export function planAllocation(
  installments: InstallmentRow[],
  amount: number,
  explicit?: Allocation[],
) {
  try {
    const plan = allocatePayment(
      installments.map((i) => ({ id: i.id, dueDate: i.due_date, remaining: i.remaining })),
      amount,
      explicit,
    );
    return plan.map((a) => {
      const i = installments.find((x) => x.id === a.installmentId)!;
      return {
        installmentId: a.installmentId,
        saleId: i.sale_id,
        invoiceNumber: i.invoice_number,
        seq: i.seq,
        dueDate: i.due_date,
        amount: a.amount,
        remainingBefore: i.remaining,
        remainingAfter: i.remaining - a.amount,
      };
    });
  } catch (error) {
    throw new AppError(
      409,
      'ALLOCATION',
      error instanceof Error ? error.message : 'Invalid allocation',
    );
  }
}

export async function previewRepayment(
  db: Database,
  actor: Actor,
  customerId: string,
  input: unknown,
) {
  requirePermission(actor, 'payments.write');
  const p = repaymentPreviewSchema.parse(input);
  const installments = await openInstallments(db, actor, customerId);
  const outstanding = installments.reduce((s, i) => s + i.remaining, 0);
  return { outstanding, allocations: planAllocation(installments, p.amount, p.allocations) };
}

export async function customerInstallments(db: Database, actor: Actor, customerId: string) {
  requirePermission(actor, 'payments.write');
  return db.query(
    `${installmentRows} WHERE ib.shop_id=$1 AND c.id=$2 ORDER BY ib.due_date,s.created_at,ib.seq`,
    [actor.shopId, customerId],
  );
}

const dueQuery = z.object({
  status: z.enum(['actionable', 'all', ...installmentStates]).default('actionable'),
  type: z.enum(['all', 'driver', 'normal']).default('all'),
  factoryId: id.optional(),
  search: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
});

/** Installments sorted overdue first, then due today, then the nearest due dates. */
export async function dueList(db: Database, actor: Actor, query: unknown) {
  requirePermission(actor, 'payments.write');
  const q = dueQuery.parse(query);
  const filters = `($2='all' OR ($2='driver' AND customer_kind='driver') OR ($2='normal' AND customer_kind<>'driver'))
    AND ($3::uuid IS NULL OR factory_id=$3)
    AND ($4='' OR customer_name ILIKE $5 OR invoice_number ILIKE $5 OR phone ILIKE $5 OR driver_code ILIKE $5 OR lorry_number ILIKE $5 OR factory ILIKE $5)`;
  const params = [actor.shopId, q.type, q.factoryId ?? null, q.search, `%${q.search}%`];
  const base = `SELECT * FROM (${installmentRows} WHERE ib.shop_id=$1) t WHERE ${filters}`;
  const rows = await db.query(
    `${base} AND ($6='all' OR ($6='actionable' AND status<>'paid') OR status=$6) ORDER BY ${statusRank},due_date,sale_date,seq LIMIT $7`,
    [...params, q.status, q.limit],
  );
  const summary = await db.query<{ status: string; count: number; remaining: number }>(
    `SELECT status,COUNT(*)::int count,COALESCE(SUM(remaining),0)::bigint remaining FROM (${base}) s GROUP BY status`,
    params,
  );
  return {
    rows,
    summary: Object.fromEntries(
      installmentStates.map((s) => {
        const r = summary.find((x) => x.status === s);
        return [s, { count: r?.count ?? 0, remaining: Number(r?.remaining ?? 0) }];
      }),
    ),
  };
}

/** Receipt for one repayment, including the invoices and installments it settled. */
export async function repaymentReceipt(db: Database, actor: Actor, paymentId: string) {
  requirePermission(actor, 'payments.write');
  const payment = (
    await db.query(
      `SELECT l.id,l.created_at,(-l.amount)::bigint amount,COALESCE(l.method,split_part(l.reference,':',1)) method,l.reference,l.notes,
        c.id customer_id,c.name customer_name,c.kind customer_kind,c.driver_code,c.phone,f.name factory,st.name cashier,
        (SELECT COALESCE(SUM(x.amount),0) FROM customer_ledger x WHERE x.customer_id=l.customer_id AND (x.created_at,x.id)<=(l.created_at,l.id))::bigint balance_after
       FROM customer_ledger l JOIN customers c ON c.id=l.customer_id LEFT JOIN factories f ON f.id=c.factory_id JOIN staff st ON st.id=l.actor_id
       WHERE l.shop_id=$1 AND l.id=$2 AND l.type='repayment'`,
      [actor.shopId, paymentId],
    )
  )[0];
  assert(payment, 404, 'NOT_FOUND', 'Payment not found');
  const allocations = await db.query(
    `SELECT a.amount,i.seq,i.due_date::text due_date,i.amount installment_amount,s.invoice_number,
      (SELECT COUNT(*)::int FROM credit_installments x WHERE x.sale_id=s.id) installment_count
     FROM installment_allocations a JOIN credit_installments i ON i.id=a.installment_id JOIN sales s ON s.id=i.sale_id
     WHERE a.ledger_id=$1 ORDER BY i.due_date,s.invoice_number,i.seq`,
    [paymentId],
  );
  const shop = (
    await db.query('SELECT name,address,phone,receipt_footer FROM shops WHERE id=$1', [
      actor.shopId,
    ])
  )[0];
  return { ...payment, allocations, shop };
}
