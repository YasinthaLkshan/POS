import { type Actor, type Report, type ReportKind } from '@agripos/shared';
import type { Database } from '../../database/db';
import { requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
type Definition = {
  title: string;
  columns: Report['columns'];
  sql: string;
  dates?: boolean;
  cost?: boolean;
};
const col = (key: string, label: string, format?: 'money' | 'quantity' | 'date') => ({
  key,
  label,
  format,
});
const period = "(created_at AT TIME ZONE 'Asia/Colombo')::date BETWEEN $2::date AND $3::date";
const definitions: Record<ReportKind, Definition> = {
  products: {
    title: 'Product performance (net of returns)',
    dates: true,
    columns: [
      col('name', 'Product'),
      col('quantity', 'Net quantity', 'quantity'),
      col('revenue', 'Net sales', 'money'),
    ],
    sql: `WITH events AS (SELECT l.product_id,l.quantity,l.total revenue,s.created_at FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE l.shop_id=$1 UNION ALL SELECT l.product_id,-r.quantity,-r.total,h.created_at FROM return_lines r JOIN returns h ON h.id=r.return_id JOIN sale_lines l ON l.id=r.sale_line_id WHERE r.shop_id=$1) SELECT p.name,COALESCE(SUM(e.quantity) FILTER(WHERE ${period.replace('created_at', 'e.created_at')}),0)::bigint quantity,COALESCE(SUM(e.revenue) FILTER(WHERE ${period.replace('created_at', 'e.created_at')}),0)::bigint revenue FROM products p LEFT JOIN events e ON e.product_id=p.id WHERE p.shop_id=$1 GROUP BY p.id ORDER BY quantity DESC,p.name`,
  },
  categories: {
    title: 'Sales by category',
    dates: true,
    columns: [col('name', 'Category'), col('revenue', 'Net sales', 'money')],
    sql: `WITH events AS (SELECT l.product_id,l.total revenue,s.created_at FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE l.shop_id=$1 UNION ALL SELECT l.product_id,-r.total,h.created_at FROM return_lines r JOIN returns h ON h.id=r.return_id JOIN sale_lines l ON l.id=r.sale_line_id WHERE r.shop_id=$1) SELECT c.name,SUM(e.revenue)::bigint revenue FROM events e JOIN products p ON p.id=e.product_id JOIN categories c ON c.id=p.category_id WHERE ${period.replace('created_at', 'e.created_at')} GROUP BY c.id ORDER BY revenue DESC`,
  },
  employees: {
    title: 'Sales by employee (original sales)',
    dates: true,
    columns: [
      col('name', 'Employee'),
      col('transactions', 'Invoices'),
      col('revenue', 'Sales', 'money'),
    ],
    sql: `SELECT st.name,COUNT(*)::int transactions,SUM(s.total)::bigint revenue FROM sales s JOIN staff st ON st.id=s.cashier_id WHERE s.shop_id=$1 AND ${period.replace('created_at', 's.created_at')} GROUP BY st.id ORDER BY revenue DESC`,
  },
  inventory: {
    title: 'Current stock valuation',
    cost: true,
    columns: [
      col('name', 'Product'),
      col('batch_number', 'Batch'),
      col('quantity', 'On hand', 'quantity'),
      col('unit_cost', 'Unit cost', 'money'),
      col('valuation', 'Value', 'money'),
    ],
    sql: 'SELECT p.name,b.batch_number,b.quantity,b.unit_cost,round(b.unit_cost::numeric*b.quantity/1000)::bigint valuation FROM batches b JOIN products p ON p.id=b.product_id WHERE b.shop_id=$1 ORDER BY p.name,b.batch_number',
  },
  'low-stock': {
    title: 'Current low stock',
    columns: [
      col('name', 'Product'),
      col('sku', 'SKU'),
      col('stock', 'Available', 'quantity'),
      col('minimum_stock', 'Minimum', 'quantity'),
    ],
    sql: `SELECT p.name,p.sku,p.minimum_stock,COALESCE(SUM(b.quantity) FILTER(WHERE b.expiry_date IS NULL OR b.expiry_date>=(now() AT TIME ZONE 'Asia/Colombo')::date),0)::bigint stock FROM products p LEFT JOIN batches b ON b.product_id=p.id WHERE p.shop_id=$1 AND p.active GROUP BY p.id HAVING COALESCE(SUM(b.quantity) FILTER(WHERE b.expiry_date IS NULL OR b.expiry_date>=(now() AT TIME ZONE 'Asia/Colombo')::date),0)<=p.minimum_stock ORDER BY stock,p.name`,
  },
  expiry: {
    title: 'Expired and approaching expiry stock',
    columns: [
      col('name', 'Product'),
      col('batch_number', 'Batch'),
      col('expiry_date', 'Expiry', 'date'),
      col('quantity', 'On hand', 'quantity'),
    ],
    sql: `SELECT p.name,b.batch_number,b.expiry_date,b.quantity FROM batches b JOIN products p ON p.id=b.product_id JOIN shops s ON s.id=b.shop_id WHERE b.shop_id=$1 AND b.quantity>0 AND b.expiry_date<=(now() AT TIME ZONE 'Asia/Colombo')::date+s.expiry_alert_days ORDER BY b.expiry_date,p.name`,
  },
  purchases: {
    title: 'Purchases by order date',
    dates: true,
    cost: true,
    columns: [
      col('id', 'Order'),
      col('supplier', 'Supplier'),
      col('status', 'Status'),
      col('ordered', 'Order value', 'money'),
      col('received', 'Received value', 'money'),
    ],
    sql: `SELECT p.id,s.name supplier,p.status,SUM(round(l.unit_cost::numeric*l.quantity/1000))::bigint ordered,SUM(round(l.unit_cost::numeric*l.received/1000))::bigint received FROM purchases p JOIN suppliers s ON s.id=p.supplier_id JOIN purchase_lines l ON l.purchase_id=p.id WHERE p.shop_id=$1 AND ${period.replace('created_at', 'p.created_at')} GROUP BY p.id,s.name ORDER BY p.created_at DESC`,
  },
  expenses: {
    title: 'Expenses',
    dates: true,
    columns: [
      col('date', 'Date', 'date'),
      col('category', 'Category'),
      col('description', 'Description'),
      col('amount', 'Amount', 'money'),
    ],
    sql: 'SELECT date,category,description,amount FROM expenses WHERE shop_id=$1 AND voided_at IS NULL AND date BETWEEN $2::date AND $3::date ORDER BY date DESC',
  },
  'customer-balances': {
    title: 'Current customer balances and overdue invoices',
    columns: [
      col('name', 'Customer'),
      col('phone', 'Phone'),
      col('balance', 'Outstanding', 'money'),
      col('overdue', 'Overdue', 'money'),
    ],
    sql: `WITH invoices AS(SELECT s.customer_id,s.due_date,(s.credit-COALESCE((SELECT SUM(a.amount) FROM repayment_allocations a WHERE a.sale_id=s.id),0)-COALESCE((SELECT SUM(r.credit_amount) FROM returns r WHERE r.sale_id=s.id),0))::bigint due FROM sales s WHERE s.shop_id=$1 AND s.credit>0) SELECT c.name,c.phone,COALESCE(SUM(i.due),0)::bigint balance,COALESCE(SUM(i.due) FILTER(WHERE i.due_date<(now() AT TIME ZONE 'Asia/Colombo')::date),0)::bigint overdue FROM customers c LEFT JOIN invoices i ON i.customer_id=c.id WHERE c.shop_id=$1 GROUP BY c.id ORDER BY balance DESC`,
  },
  'supplier-balances': {
    title: 'Current supplier balances',
    columns: [col('name', 'Supplier'), col('phone', 'Phone'), col('balance', 'Payable', 'money')],
    sql: 'SELECT s.name,s.phone,COALESCE(SUM(l.amount),0)::bigint balance FROM suppliers s LEFT JOIN supplier_ledger l ON l.supplier_id=s.id WHERE s.shop_id=$1 GROUP BY s.id ORDER BY balance DESC',
  },
  'cash-closing': {
    title: 'Register reconciliation by opening date',
    dates: true,
    columns: [
      col('name', 'Employee'),
      col('opened_at', 'Opened', 'date'),
      col('closed_at', 'Closed', 'date'),
      col('expected_close', 'Expected', 'money'),
      col('actual_close', 'Counted', 'money'),
      col('difference', 'Difference', 'money'),
    ],
    sql: `SELECT st.name,c.opened_at,c.closed_at,c.expected_close,c.actual_close,c.difference FROM cash_sessions c JOIN staff st ON st.id=c.opened_by WHERE c.shop_id=$1 AND ${period.replace('created_at', 'c.opened_at')} ORDER BY c.opened_at DESC`,
  },
  returns: {
    title: 'Returns and refunds',
    dates: true,
    columns: [
      col('sale_id', 'Invoice'),
      col('created_at', 'Date', 'date'),
      col('reason', 'Reason'),
      col('total_amount', 'Returned value', 'money'),
      col('credit_amount', 'Credit reduced', 'money'),
      col('refund_amount', 'Refund', 'money'),
      col('refund_method', 'Method'),
    ],
    sql: `SELECT sale_id,created_at,reason,total_amount,credit_amount,refund_amount,refund_method FROM returns WHERE shop_id=$1 AND ${period} ORDER BY created_at DESC`,
  },
  movements: {
    title: 'Inventory movement history',
    dates: true,
    columns: [
      col('name', 'Product'),
      col('batch_number', 'Batch'),
      col('created_at', 'Date', 'date'),
      col('type', 'Type'),
      col('delta', 'Quantity change', 'quantity'),
      col('reason', 'Reason'),
    ],
    sql: `SELECT p.name,b.batch_number,m.created_at,m.type,m.delta,m.reason FROM inventory_movements m JOIN batches b ON b.id=m.batch_id JOIN products p ON p.id=b.product_id WHERE m.shop_id=$1 AND ${period.replace('created_at', 'm.created_at')} ORDER BY m.created_at DESC`,
  },
  audit: {
    title: 'Administrative activity',
    dates: true,
    columns: [
      col('name', 'Employee'),
      col('created_at', 'Date', 'date'),
      col('action', 'Action'),
      col('entity_id', 'Record'),
    ],
    sql: `SELECT st.name,a.created_at,a.action,a.entity_id FROM audit_logs a JOIN staff st ON st.id=a.actor_id WHERE a.shop_id=$1 AND ${period.replace('created_at', 'a.created_at')} ORDER BY a.created_at DESC`,
  },
};
export async function report(
  db: Database,
  actor: Actor,
  kind: ReportKind,
  from: string,
  to: string,
): Promise<Report> {
  requirePermission(actor, 'reports.read');
  const definition = definitions[kind];
  if (definition.cost) requirePermission(actor, 'cost.read');
  if (kind === 'audit') requirePermission(actor, 'staff.manage');
  assert(
    from <= to && Date.parse(to) - Date.parse(from) <= 366 * 86400000,
    422,
    'DATE_RANGE',
    'Choose a date range of at most one year',
  );
  const rows = await db.query(
    `${definition.sql} LIMIT 10001`,
    definition.dates ? [actor.shopId, from, to] : [actor.shopId],
  );
  return {
    title: definition.title,
    columns: definition.columns,
    rows: rows.slice(0, 10000),
    truncated: rows.length > 10000,
  };
}
