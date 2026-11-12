import { can, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
export async function summary(db: Database, actor: Actor) {
  requirePermission(actor, 'catalog.read');
  const sales = (
    await db.query(
      `SELECT COALESCE(SUM(transactions),0)::int transactions,COALESCE(SUM(total),0)::bigint revenue,COALESCE(SUM(total-tax-cost),0)::bigint profit FROM financial_events WHERE shop_id=$1 AND (created_at AT TIME ZONE 'Asia/Colombo')::date=(now() AT TIME ZONE 'Asia/Colombo')::date`,
      [actor.shopId],
    )
  )[0]!;
  const inventory = (
    await db.query(
      `SELECT COUNT(*)::int products,COUNT(*) FILTER(WHERE stock<=minimum_stock)::int low_stock FROM (SELECT p.minimum_stock,COALESCE(SUM(b.quantity) FILTER(WHERE b.expiry_date IS NULL OR b.expiry_date >= (now() AT TIME ZONE 'Asia/Colombo')::date),0) stock FROM products p LEFT JOIN batches b ON b.product_id=p.id WHERE p.shop_id=$1 AND p.active GROUP BY p.id) t`,
      [actor.shopId],
    )
  )[0]!;
  const debt = (
    await db.query(
      'SELECT COALESCE(SUM(amount),0)::bigint outstanding FROM customer_ledger WHERE shop_id=$1',
      [actor.shopId],
    )
  )[0]!;
  if (!can(actor.role, 'profit.read')) delete sales.profit;
  if (!can(actor.role, 'reports.read')) {
    delete debt.outstanding;
    delete sales.revenue;
    delete sales.transactions;
  }
  return { ...sales, ...inventory, ...debt };
}
export async function trend(db: Database, actor: Actor, from: string, to: string) {
  requirePermission(actor, 'reports.read');
  assert(
    from <= to && new Date(to).getTime() - new Date(from).getTime() <= 366 * 86400000,
    422,
    'DATE_RANGE',
    'Choose a date range of at most one year',
  );
  return db.query(
    `SELECT (created_at AT TIME ZONE 'Asia/Colombo')::date AS "day",SUM(transactions)::int transactions,SUM(total)::bigint revenue FROM financial_events WHERE shop_id=$1 AND (created_at AT TIME ZONE 'Asia/Colombo')::date BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY 1`,
    [actor.shopId, from, to],
  );
}
export async function inventory(db: Database, actor: Actor, limit = 100, page = 1) {
  requirePermission(actor, 'catalog.read');
  const rows = await db.query(
    'SELECT b.*,p.name,p.sku,p.unit FROM batches b JOIN products p ON p.id=b.product_id WHERE b.shop_id=$1 ORDER BY b.expiry_date NULLS LAST,b.created_at DESC,b.id LIMIT $2 OFFSET $3',
    [actor.shopId, limit, (page - 1) * limit],
  );
  if (!can(actor.role, 'cost.read')) rows.forEach((r) => delete r.unit_cost);
  return rows;
}
export async function saleDetails(db: Database, actor: Actor, saleId: string) {
  requirePermission(actor, 'sales.write');
  const sale = (
    await db.query(
      'SELECT s.*,st.name cashier FROM sales s JOIN staff st ON st.id=s.cashier_id WHERE s.shop_id=$1 AND s.id=$2',
      [actor.shopId, saleId],
    )
  )[0];
  if (!sale) return null;
  if (!can(actor.role, 'cost.read')) delete sale.cost;
  const lines = await db.query(
    'SELECT l.*,COALESCE((SELECT SUM(r.quantity) FROM return_lines r WHERE r.sale_line_id=l.id),0)::bigint returned FROM sale_lines l WHERE shop_id=$1 AND sale_id=$2 ORDER BY name',
    [actor.shopId, saleId],
  );
  if (!can(actor.role, 'cost.read')) lines.forEach((r) => delete r.cost);
  return {
    ...sale,
    lines,
    returns: await db.query(
      'SELECT id,reason,restock,total_amount,refund_amount,credit_amount,refund_method,reference,created_at FROM returns WHERE shop_id=$1 AND sale_id=$2 ORDER BY created_at',
      [actor.shopId, saleId],
    ),
    outstanding: (
      await db.query(
        'SELECT (s.credit-COALESCE((SELECT SUM(a.amount) FROM repayment_allocations a WHERE a.sale_id=s.id),0)-COALESCE((SELECT SUM(r.credit_amount) FROM returns r WHERE r.sale_id=s.id),0))::bigint amount FROM sales s WHERE s.shop_id=$1 AND s.id=$2',
        [actor.shopId, saleId],
      )
    )[0]?.amount,
    payments: await db.query(
      'SELECT method,amount,reference FROM payments WHERE shop_id=$1 AND sale_id=$2',
      [actor.shopId, saleId],
    ),
    shop: (
      await db.query('SELECT name,address,phone,receipt_footer FROM shops WHERE id=$1', [
        actor.shopId,
      ])
    )[0],
  };
}
