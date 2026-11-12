import type { Actor, Report } from '@agripos/shared';
import type { Database } from '../../database/db';
import { requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
export async function account(
  db: Database,
  actor: Actor,
  kind: 'customers' | 'suppliers',
  contactId: string,
) {
  requirePermission(actor, kind === 'customers' ? 'customers.write' : 'purchases.write');
  const contact = (
    await db.query<{ name: string }>(`SELECT * FROM ${kind} WHERE shop_id=$1 AND id=$2`, [
      actor.shopId,
      contactId,
    ])
  )[0];
  assert(contact, 404, 'NOT_FOUND', 'Account not found');
  const table = kind === 'customers' ? 'customer_ledger' : 'supplier_ledger',
    column = kind === 'customers' ? 'customer_id' : 'supplier_id';
  const rows = await db.query(
    `SELECT id,created_at,type,amount,reference,SUM(amount) OVER(ORDER BY created_at,id)::bigint balance FROM ${table} WHERE shop_id=$1 AND ${column}=$2 ORDER BY created_at,id LIMIT 10001`,
    [actor.shopId, contactId],
  );
  const statement: Report = {
    title: `${contact.name} — ${kind === 'customers' ? 'customer' : 'supplier'} account statement`,
    columns: [
      { key: 'created_at', label: 'Date', format: 'date' },
      { key: 'type', label: 'Movement' },
      { key: 'reference', label: 'Reference' },
      { key: 'amount', label: 'Debit / credit', format: 'money' },
      { key: 'balance', label: 'Running balance', format: 'money' },
    ],
    rows: rows.slice(0, 10000),
    truncated: rows.length > 10000,
  };
  const history =
    kind === 'customers'
      ? await db.query(
          `SELECT s.id,s.created_at,s.status,s.total,s.due_date,(s.credit-COALESCE((SELECT SUM(a.amount) FROM repayment_allocations a WHERE a.sale_id=s.id),0)-COALESCE((SELECT SUM(r.credit_amount) FROM returns r WHERE r.sale_id=s.id),0))::bigint outstanding FROM sales s WHERE s.shop_id=$1 AND s.customer_id=$2 ORDER BY s.created_at DESC LIMIT 200`,
          [actor.shopId, contactId],
        )
      : await db.query(
          'SELECT id,created_at,status,invoice_number,due_date FROM purchases WHERE shop_id=$1 AND supplier_id=$2 ORDER BY created_at DESC LIMIT 200',
          [actor.shopId, contactId],
        );
  return { contact, statement, history };
}
