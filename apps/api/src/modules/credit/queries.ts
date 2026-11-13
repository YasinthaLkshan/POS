export const TODAY = "(now() AT TIME ZONE 'Asia/Colombo')::date";

/** One row per installment with its invoice, customer, factory and due status. */
export const installmentRows = `SELECT ib.id,ib.sale_id,ib.seq,ib.due_date::text due_date,ib.amount,ib.paid,ib.reduced,ib.remaining,
 s.invoice_number,s.created_at sale_date,s.credit original_credit,s.total invoice_total,s.notes sale_notes,
 c.id customer_id,c.name customer_name,c.kind customer_kind,c.phone,c.driver_code,c.lorry_number,
 f.id factory_id,f.name factory,(ib.due_date-${TODAY})::int days,
 CASE WHEN ib.remaining<=0 THEN 'paid' WHEN ib.due_date<${TODAY} THEN 'overdue' WHEN ib.due_date=${TODAY} THEN 'due_today'
  WHEN ib.due_date<=${TODAY}+sh.due_soon_days THEN 'due_soon' ELSE 'upcoming' END status,
 (SELECT COUNT(*)::int FROM credit_installments x WHERE x.sale_id=ib.sale_id) installment_count
FROM installment_balances ib JOIN sales s ON s.id=ib.sale_id JOIN customers c ON c.id=s.customer_id
LEFT JOIN factories f ON f.id=c.factory_id JOIN shops sh ON sh.id=ib.shop_id`;

export const statusRank =
  "CASE status WHEN 'overdue' THEN 0 WHEN 'due_today' THEN 1 WHEN 'due_soon' THEN 2 WHEN 'upcoming' THEN 3 ELSE 4 END";

/** Outstanding invoice credit: original credit minus repayments and returned credit. */
export const invoiceOutstanding = (sale = 's') =>
  `(${sale}.credit-COALESCE((SELECT SUM(a.amount) FROM repayment_allocations a WHERE a.sale_id=${sale}.id),0)-COALESCE((SELECT SUM(r.credit_amount) FROM returns r WHERE r.sale_id=${sale}.id),0))::bigint`;

/** Per-customer balance columns derived from the immutable ledger and installments. */
export const customerBalances = (customer = 'c') => `
 COALESCE((SELECT SUM(l.amount) FROM customer_ledger l WHERE l.customer_id=${customer}.id),0)::bigint outstanding,
 COALESCE((SELECT SUM(ib.remaining) FROM installment_balances ib JOIN sales s ON s.id=ib.sale_id WHERE s.customer_id=${customer}.id AND ib.remaining>0 AND ib.due_date<${TODAY}),0)::bigint overdue,
 (SELECT MIN(ib.due_date)::text FROM installment_balances ib JOIN sales s ON s.id=ib.sale_id WHERE s.customer_id=${customer}.id AND ib.remaining>0) next_due`;

export const paymentType =
  "CASE WHEN s.credit=0 THEN 'cash' WHEN s.credit=s.total THEN 'credit' ELSE 'mixed' END";
