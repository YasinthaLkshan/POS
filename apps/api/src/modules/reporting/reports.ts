import { type Actor, type Report, type ReportKind } from '@agripos/shared';
import type { Database } from '../../database/db';
import { requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
import { TODAY, customerBalances, installmentRows } from '../credit/queries';
import { businessSummary } from './daily';

async function summaryReport(
  db: Database,
  actor: Actor,
  from: string,
  to: string,
): Promise<Report> {
  const { summary: s } = await businessSummary(db, actor, from, to);
  const rows: [string, unknown, unknown?][] = [
    ['Invoices', null, s.transactions],
    ['Gross sales (before discounts)', s.gross_sales],
    ['Driver discounts', s.driver_discounts],
    ['Bill discounts', s.bill_discounts],
    ['Other discounts', s.other_discounts],
    ['Sales after discounts', s.sales_total],
    ['Returns', s.returns_total, s.returns_count],
    ['Net sales', s.net_sales],
    ['Fully paid sales', s.paid_total, s.paid_count],
    ['Fully credit sales', s.credit_total, s.credit_count],
    ['Mixed cash/credit sales', s.mixed_total, s.mixed_count],
    ['Cash received from new sales', s.cash_from_sales],
    ['Card received from new sales', s.card_from_sales],
    ['Bank transfers from new sales', s.transfer_from_sales],
    ['New credit created', s.credit_created],
    ['Credit repayments received', s.repayments_total, s.repayment_count],
    ['  of which cash', s.repayments_cash],
    ['Credit reduced by returns', s.credit_reduced_by_returns],
    ['Refunds paid', s.refunds_total],
    ['  of which cash', s.cash_refunds],
    ['Net cash collected', s.net_cash_collected],
    ['Outstanding receivables (now)', s.outstanding],
    ['Overdue (now)', s.overdue, s.overdue_invoices],
    ['Due today (now)', s.due_today, s.due_today_invoices],
    ...(s.gross_profit !== undefined
      ? ([['Estimated gross profit', s.gross_profit]] as [string, unknown][])
      : []),
  ];
  return {
    title: from === to ? `Business summary ${from}` : `Business summary ${from} to ${to}`,
    columns: [
      { key: 'item', label: 'Item' },
      { key: 'count', label: 'Count' },
      { key: 'amount', label: 'Amount', format: 'money' },
    ],
    rows: rows.map(([item, amount, count]) => ({ item, amount, count: count ?? '' })),
    truncated: false,
  };
}
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
const cashOf = (sale: string) =>
  `COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sale_id=${sale}.id AND p.method='cash'),0)::bigint`;
const salesRegister = (title: string, filter: string): Definition => ({
  title,
  dates: true,
  columns: [
    col('invoice_number', 'Invoice'),
    col('created_at', 'Date', 'date'),
    col('customer', 'Customer'),
    col('factory', 'Factory'),
    col('discount', 'Discount', 'money'),
    col('total', 'Invoice total', 'money'),
    col('cash', 'Cash', 'money'),
    col('credit', 'Credit', 'money'),
  ],
  sql: `SELECT s.invoice_number,s.created_at,COALESCE(NULLIF(s.customer_name,''),'Walk-in') customer,f.name factory,s.discount,s.total,${cashOf('s')} cash,s.credit
   FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN factories f ON f.id=c.factory_id
   WHERE s.shop_id=$1 AND ${period.replace('created_at', 's.created_at')} AND ${filter} ORDER BY s.created_at DESC`,
});
const installmentReport = (title: string, filter: string): Definition => ({
  title,
  columns: [
    col('customer_name', 'Customer'),
    col('type', 'Type'),
    col('factory', 'Factory'),
    col('invoice_number', 'Invoice'),
    col('installment', 'Installment'),
    col('due_date', 'Due date', 'date'),
    col('amount', 'Original', 'money'),
    col('paid', 'Paid', 'money'),
    col('remaining', 'Remaining', 'money'),
  ],
  sql: `SELECT customer_name,CASE customer_kind WHEN 'driver' THEN 'Driver' ELSE 'Normal customer' END type,factory,invoice_number,
    seq||' of '||installment_count installment,due_date,amount,paid,remaining
   FROM (${installmentRows} WHERE ib.shop_id=$1) t WHERE remaining>0 AND ${filter} ORDER BY due_date,customer_name`,
});
const definitions: Record<Exclude<ReportKind, 'business-summary'>, Definition> = {
  'daily-sales': {
    title: 'Daily sales (returns on their return date)',
    dates: true,
    columns: [
      col('day', 'Business date', 'date'),
      col('invoices', 'Invoices'),
      col('gross', 'Gross sales', 'money'),
      col('discounts', 'Discounts', 'money'),
      col('sales', 'Sales after discounts', 'money'),
      col('returns', 'Returns', 'money'),
      col('net', 'Net sales', 'money'),
      col('cash', 'Cash from sales', 'money'),
      col('credit', 'New credit', 'money'),
    ],
    sql: `WITH s AS (SELECT (created_at AT TIME ZONE 'Asia/Colombo')::date d,COUNT(*) invoices,SUM(subtotal) gross,SUM(discount) discounts,SUM(total) sales,SUM(${cashOf('x')}) cash,SUM(credit) credit FROM sales x WHERE shop_id=$1 AND ${period} GROUP BY 1),
     r AS (SELECT (created_at AT TIME ZONE 'Asia/Colombo')::date d,SUM(total_amount) returns FROM returns WHERE shop_id=$1 AND ${period} GROUP BY 1)
     SELECT COALESCE(s.d,r.d)::text AS day,COALESCE(s.invoices,0)::int invoices,COALESCE(s.gross,0)::bigint gross,COALESCE(s.discounts,0)::bigint discounts,
      COALESCE(s.sales,0)::bigint sales,COALESCE(r.returns,0)::bigint returns,(COALESCE(s.sales,0)-COALESCE(r.returns,0))::bigint net,
      COALESCE(s.cash,0)::bigint cash,COALESCE(s.credit,0)::bigint credit
     FROM s FULL JOIN r ON r.d=s.d ORDER BY 1`,
  },
  'cash-sales': salesRegister('Fully paid sales', 's.credit=0'),
  'credit-sales': salesRegister('Fully credit sales', 's.credit>0 AND s.credit=s.total'),
  'mixed-sales': salesRegister('Mixed cash and credit sales', 's.credit>0 AND s.credit<s.total'),
  repayments: {
    title: 'Credit repayments received',
    dates: true,
    columns: [
      col('created_at', 'Date', 'date'),
      col('customer', 'Customer'),
      col('type', 'Type'),
      col('factory', 'Factory'),
      col('method', 'Method'),
      col('invoices', 'Invoices'),
      col('amount', 'Amount', 'money'),
    ],
    sql: `SELECT l.created_at,c.name customer,CASE c.kind WHEN 'driver' THEN 'Driver' ELSE 'Normal customer' END type,f.name factory,
      COALESCE(l.method,split_part(l.reference,':',1)) method,
      (SELECT string_agg(s.invoice_number,', ') FROM repayment_allocations a JOIN sales s ON s.id=a.sale_id WHERE a.ledger_id=l.id) invoices,(-l.amount)::bigint amount
     FROM customer_ledger l JOIN customers c ON c.id=l.customer_id LEFT JOIN factories f ON f.id=c.factory_id
     WHERE l.shop_id=$1 AND l.type='repayment' AND ${period.replace('created_at', 'l.created_at')} ORDER BY l.created_at DESC`,
  },
  outstanding: {
    title: 'Outstanding credit by customer',
    columns: [
      col('name', 'Customer'),
      col('type', 'Type'),
      col('factory', 'Factory'),
      col('phone', 'Phone'),
      col('outstanding', 'Outstanding', 'money'),
      col('overdue', 'Overdue', 'money'),
      col('next_due', 'Next due', 'date'),
    ],
    sql: `SELECT * FROM (SELECT c.name,CASE c.kind WHEN 'driver' THEN 'Driver' ELSE 'Normal customer' END type,f.name factory,c.phone,${customerBalances('c')}
      FROM customers c LEFT JOIN factories f ON f.id=c.factory_id WHERE c.shop_id=$1) t WHERE outstanding<>0 ORDER BY overdue DESC,outstanding DESC`,
  },
  'due-today': installmentReport('Credit due today', `due_date::date=${TODAY}`),
  overdue: installmentReport('Overdue credit', `due_date::date<${TODAY}`),
  'driver-credit': installmentReport('Driver credit installments', "customer_kind='driver'"),
  'normal-credit': installmentReport('Normal customer credit', "customer_kind<>'driver'"),
  'factory-credit': {
    title: 'Driver credit by factory',
    columns: [
      col('name', 'Factory'),
      col('drivers', 'Drivers'),
      col('outstanding', 'Outstanding', 'money'),
      col('overdue', 'Overdue', 'money'),
    ],
    sql: `SELECT f.name,(SELECT COUNT(*)::int FROM customers c WHERE c.factory_id=f.id AND c.kind='driver') drivers,
      COALESCE((SELECT SUM(l.amount) FROM customer_ledger l JOIN customers c ON c.id=l.customer_id WHERE c.factory_id=f.id AND c.kind='driver'),0)::bigint outstanding,
      COALESCE((SELECT SUM(ib.remaining) FROM installment_balances ib JOIN sales s ON s.id=ib.sale_id JOIN customers c ON c.id=s.customer_id WHERE c.factory_id=f.id AND c.kind='driver' AND ib.remaining>0 AND ib.due_date<${TODAY}),0)::bigint overdue
     FROM factories f WHERE f.shop_id=$1 ORDER BY outstanding DESC,f.name`,
  },
  discounts: {
    title: 'Discounts given',
    dates: true,
    columns: [
      col('invoice_number', 'Invoice'),
      col('created_at', 'Date', 'date'),
      col('customer', 'Customer'),
      col('driver_discount', 'Driver discount', 'money'),
      col('bill_discount', 'Bill discount', 'money'),
      col('other_discount', 'Other line discounts', 'money'),
      col('discount', 'Total discount', 'money'),
    ],
    sql: `SELECT * FROM (SELECT s.invoice_number,s.created_at,COALESCE(NULLIF(s.customer_name,''),'Walk-in') customer,
      COALESCE((SELECT SUM(l.auto_discount) FROM sale_lines l WHERE l.sale_id=s.id),0)::bigint driver_discount,s.bill_discount,s.discount
     FROM sales s WHERE s.shop_id=$1 AND s.discount>0 AND ${period.replace('created_at', 's.created_at')}) t,
     LATERAL (SELECT (t.discount-t.bill_discount-t.driver_discount)::bigint other_discount) o ORDER BY created_at DESC`,
  },
  stock: {
    title: 'Current stock availability',
    columns: [
      col('name', 'Product'),
      col('sku', 'SKU'),
      col('category', 'Category'),
      col('unit', 'Unit'),
      col('stock', 'Available', 'quantity'),
      col('minimum_stock', 'Reorder level', 'quantity'),
      col('status', 'Status'),
    ],
    sql: `SELECT name,sku,category,unit,stock,minimum_stock,CASE WHEN stock<=0 THEN 'Out of stock' WHEN stock<=minimum_stock THEN 'Low stock' ELSE 'In stock' END status
     FROM (SELECT p.name,p.sku,c.name category,p.unit,p.minimum_stock,COALESCE(SUM(b.quantity) FILTER(WHERE b.expiry_date IS NULL OR b.expiry_date>=${TODAY}),0)::bigint stock
      FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN batches b ON b.product_id=p.id WHERE p.shop_id=$1 AND p.active GROUP BY p.id,c.name) t ORDER BY name`,
  },
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
  if (kind === 'business-summary') return summaryReport(db, actor, from, to);
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
