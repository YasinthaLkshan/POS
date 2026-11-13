import { can, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
import { TODAY, paymentType } from '../credit/queries';

const inRange = (column: string) =>
  `(${column} AT TIME ZONE 'Asia/Colombo')::date BETWEEN $2::date AND $3::date`;
const n = (value: unknown) => Number(value ?? 0);

export function checkRange(from: string, to: string) {
  assert(
    from <= to && Date.parse(to) - Date.parse(from) <= 366 * 86400000,
    422,
    'DATE_RANGE',
    'Choose a date range of at most one year',
  );
}

/**
 * Business-day accounting shared by the dashboard, Daily business page, reports and end-of-day print.
 * Sales count on their sale date, returns on their return date and repayments on their payment date;
 * repayments are cash received, never new sales.
 */
export async function businessSummary(
  db: Database,
  actor: Actor,
  from: string,
  to: string,
  details = false,
) {
  requirePermission(actor, 'reports.read');
  checkRange(from, to);
  const params = [actor.shopId, from, to];
  const sales = (
    await db.query(
      `SELECT COUNT(*)::int transactions,COALESCE(SUM(subtotal),0)::bigint gross_sales,COALESCE(SUM(discount),0)::bigint discounts,
        COALESCE(SUM(bill_discount),0)::bigint bill_discounts,COALESCE(SUM(tax),0)::bigint tax,COALESCE(SUM(total),0)::bigint sales_total,
        COALESCE(SUM(credit),0)::bigint credit_created,
        COALESCE(SUM((SELECT SUM(l.auto_discount) FROM sale_lines l WHERE l.sale_id=s.id)),0)::bigint driver_discounts,
        COUNT(*) FILTER(WHERE credit=0)::int paid_count,COALESCE(SUM(total) FILTER(WHERE credit=0),0)::bigint paid_total,
        COUNT(*) FILTER(WHERE credit>0 AND credit=total)::int credit_count,COALESCE(SUM(total) FILTER(WHERE credit>0 AND credit=total),0)::bigint credit_total,
        COUNT(*) FILTER(WHERE credit>0 AND credit<total)::int mixed_count,COALESCE(SUM(total) FILTER(WHERE credit>0 AND credit<total),0)::bigint mixed_total
       FROM sales s WHERE shop_id=$1 AND ${inRange('s.created_at')}`,
      params,
    )
  )[0]!;
  const payments = await db.query<{ method: string; amount: number }>(
    `SELECT p.method,SUM(p.amount)::bigint amount FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.shop_id=$1 AND ${inRange('s.created_at')} GROUP BY p.method`,
    params,
  );
  const repayments = await db.query<{ method: string; count: number; amount: number }>(
    `SELECT COALESCE(l.method,split_part(l.reference,':',1)) method,COUNT(*)::int count,SUM(-l.amount)::bigint amount FROM customer_ledger l WHERE l.shop_id=$1 AND l.type='repayment' AND ${inRange('l.created_at')} GROUP BY 1`,
    params,
  );
  const returns = (
    await db.query(
      `SELECT COUNT(*)::int count,COALESCE(SUM(total_amount),0)::bigint returned,COALESCE(SUM(credit_amount),0)::bigint credit_reduced,
        COALESCE(SUM(refund_amount),0)::bigint refunds,COALESCE(SUM(refund_amount) FILTER(WHERE refund_method='cash'),0)::bigint cash_refunds
       FROM returns WHERE shop_id=$1 AND ${inRange('created_at')}`,
      params,
    )
  )[0]!;
  const credit = (
    await db.query(
      `SELECT COALESCE((SELECT SUM(amount) FROM customer_ledger WHERE shop_id=$1),0)::bigint outstanding,
        COALESCE(SUM(ib.remaining) FILTER(WHERE ib.due_date<${TODAY}),0)::bigint overdue,
        COALESCE(SUM(ib.remaining) FILTER(WHERE ib.due_date=${TODAY}),0)::bigint due_today,
        COALESCE(SUM(ib.remaining) FILTER(WHERE ib.due_date>${TODAY} AND ib.due_date<=${TODAY}+sh.due_soon_days),0)::bigint due_soon,
        COUNT(DISTINCT ib.sale_id) FILTER(WHERE ib.due_date<${TODAY})::int overdue_invoices,
        COUNT(DISTINCT ib.sale_id) FILTER(WHERE ib.due_date=${TODAY})::int due_today_invoices
       FROM shops sh LEFT JOIN installment_balances ib ON ib.shop_id=sh.id AND ib.remaining>0 WHERE sh.id=$1 GROUP BY sh.due_soon_days`,
      [actor.shopId],
    )
  )[0]!;
  const byMethod = (rows: { method: string; amount: number }[], method: string) =>
    n(rows.find((r) => r.method === method)?.amount);
  const repaymentsTotal = repayments.reduce((s, r) => s + n(r.amount), 0);
  const summary: Record<string, number | string | null> = {
    from,
    to,
    transactions: n(sales.transactions),
    gross_sales: n(sales.gross_sales),
    driver_discounts: n(sales.driver_discounts),
    bill_discounts: n(sales.bill_discounts),
    other_discounts: n(sales.discounts) - n(sales.bill_discounts) - n(sales.driver_discounts),
    discounts: n(sales.discounts),
    tax: n(sales.tax),
    sales_total: n(sales.sales_total),
    returns_total: n(returns.returned),
    net_sales: n(sales.sales_total) - n(returns.returned),
    cash_from_sales: byMethod(payments, 'cash'),
    card_from_sales: byMethod(payments, 'card'),
    transfer_from_sales: byMethod(payments, 'transfer'),
    credit_created: n(sales.credit_created),
    paid_count: n(sales.paid_count),
    paid_total: n(sales.paid_total),
    credit_count: n(sales.credit_count),
    credit_total: n(sales.credit_total),
    mixed_count: n(sales.mixed_count),
    mixed_total: n(sales.mixed_total),
    repayment_count: repayments.reduce((s, r) => s + n(r.count), 0),
    repayments_total: repaymentsTotal,
    repayments_cash: byMethod(repayments, 'cash'),
    repayments_card: byMethod(repayments, 'card'),
    repayments_transfer: byMethod(repayments, 'transfer'),
    returns_count: n(returns.count),
    credit_reduced_by_returns: n(returns.credit_reduced),
    refunds_total: n(returns.refunds),
    cash_refunds: n(returns.cash_refunds),
    net_cash_collected:
      byMethod(payments, 'cash') + byMethod(repayments, 'cash') - n(returns.cash_refunds),
    outstanding: n(credit.outstanding),
    overdue: n(credit.overdue),
    due_today: n(credit.due_today),
    due_soon: n(credit.due_soon),
    overdue_invoices: n(credit.overdue_invoices),
    due_today_invoices: n(credit.due_today_invoices),
  };
  if (can(actor.role, 'profit.read')) {
    summary.gross_profit = n(
      (
        await db.query<{ v: number }>(
          `SELECT COALESCE(SUM(total-tax-cost),0)::bigint v FROM financial_events WHERE shop_id=$1 AND ${inRange('created_at')}`,
          params,
        )
      )[0]!.v,
    );
    summary.lines_without_cost = (
      await db.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.shop_id=$1 AND ${inRange('s.created_at')} AND l.cost=0`,
        params,
      )
    )[0]!.n;
  }
  if (!details) return { summary };
  return {
    summary,
    sales: await db.query(
      `SELECT s.id,s.invoice_number,s.created_at,s.customer_name,c.kind customer_kind,f.name factory,s.subtotal,s.discount,s.total,s.credit,s.status,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sale_id=s.id AND p.method='cash'),0)::bigint cash,
        (s.total-s.credit-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sale_id=s.id AND p.method='cash'),0))::bigint other_payments,
        ${paymentType} payment_type,st.name cashier
       FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN factories f ON f.id=c.factory_id JOIN staff st ON st.id=s.cashier_id
       WHERE s.shop_id=$1 AND ${inRange('s.created_at')} ORDER BY s.created_at DESC LIMIT 1000`,
      params,
    ),
    repayments: await db.query(
      `SELECT l.id,l.created_at,(-l.amount)::bigint amount,COALESCE(l.method,split_part(l.reference,':',1)) method,l.notes,
        c.id customer_id,c.name customer_name,c.kind customer_kind,f.name factory
       FROM customer_ledger l JOIN customers c ON c.id=l.customer_id LEFT JOIN factories f ON f.id=c.factory_id
       WHERE l.shop_id=$1 AND l.type='repayment' AND ${inRange('l.created_at')} ORDER BY l.created_at DESC LIMIT 1000`,
      params,
    ),
    returns: await db.query(
      `SELECT r.id,r.created_at,r.reason,r.total_amount,r.credit_amount,r.refund_amount,r.refund_method,s.invoice_number
       FROM returns r JOIN sales s ON s.id=r.sale_id WHERE r.shop_id=$1 AND ${inRange('r.created_at')} ORDER BY r.created_at DESC LIMIT 1000`,
      params,
    ),
  };
}
