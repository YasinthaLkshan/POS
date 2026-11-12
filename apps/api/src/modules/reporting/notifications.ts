import { can, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { requirePermission } from '../../services/transactions';
export async function notifications(db: Database, actor: Actor) {
  requirePermission(actor, 'catalog.read');
  const inventory = (
    await db.query<{ low: number; expired: number; expiring: number }>(
      `SELECT (SELECT COUNT(*)::int FROM products p WHERE p.shop_id=$1 AND p.active AND COALESCE((SELECT SUM(b.quantity) FROM batches b WHERE b.product_id=p.id AND (b.expiry_date IS NULL OR b.expiry_date>=(now() AT TIME ZONE 'Asia/Colombo')::date)),0)<=p.minimum_stock) low,(SELECT COUNT(*)::int FROM batches WHERE shop_id=$1 AND quantity>0 AND expiry_date<(now() AT TIME ZONE 'Asia/Colombo')::date) expired,(SELECT COUNT(*)::int FROM batches b JOIN shops s ON s.id=b.shop_id WHERE b.shop_id=$1 AND b.quantity>0 AND b.expiry_date BETWEEN (now() AT TIME ZONE 'Asia/Colombo')::date AND (now() AT TIME ZONE 'Asia/Colombo')::date+s.expiry_alert_days) expiring`,
      [actor.shopId],
    )
  )[0]!;
  const alerts = [
    { key: 'low', title: 'Low stock', count: inventory.low, severity: 'danger', path: '/products' },
    {
      key: 'expired',
      title: 'Expired stock',
      count: inventory.expired,
      severity: 'danger',
      path: '/inventory',
    },
    {
      key: 'expiry',
      title: 'Stock approaching expiry',
      count: inventory.expiring,
      severity: 'warning',
      path: '/inventory',
    },
  ];
  if (can(actor.role, 'reports.read')) {
    const overdue = (
      await db.query<{ count: number }>(
        `SELECT COUNT(*)::int count FROM sales s WHERE s.shop_id=$1 AND s.due_date<(now() AT TIME ZONE 'Asia/Colombo')::date AND s.credit>COALESCE((SELECT SUM(a.amount) FROM repayment_allocations a WHERE a.sale_id=s.id),0)+COALESCE((SELECT SUM(r.credit_amount) FROM returns r WHERE r.sale_id=s.id),0)`,
        [actor.shopId],
      )
    )[0]!.count;
    const conflicts = (
      await db.query<{ count: number }>(
        "SELECT COUNT(*)::int count FROM sync_operations WHERE shop_id=$1 AND state='conflict'",
        [actor.shopId],
      )
    )[0]!.count;
    alerts.push(
      {
        key: 'overdue',
        title: 'Overdue customer invoices',
        count: overdue,
        severity: 'danger',
        path: '/credit',
      },
      {
        key: 'sync',
        title: 'Offline receipts need reconciliation',
        count: conflicts,
        severity: 'danger',
        path: '/sync',
      },
    );
  }
  if (can(actor.role, 'purchases.write')) {
    const pending = (
      await db.query<{ count: number }>(
        "SELECT COUNT(*)::int count FROM purchases WHERE shop_id=$1 AND status IN ('draft','submitted','approved','ordered','sent','partial')",
        [actor.shopId],
      )
    )[0]!.count;
    alerts.push({
      key: 'purchases',
      title: 'Open purchase orders',
      count: pending,
      severity: 'info',
      path: '/purchases',
    });
  }
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
  for (const alert of alerts.filter((a) => a.count > 0))
    await db.query(
      'INSERT INTO notifications(shop_id,staff_id,title,body,severity,source_key,action_path) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(staff_id,source_key) DO NOTHING',
      [
        actor.shopId,
        actor.id,
        alert.title,
        `${alert.count} affected record(s) when checked on ${day}. Open the linked screen for current details.`,
        alert.severity,
        `${day}:${alert.key}:${alert.count}`,
        alert.path,
      ],
    );
  return db.query(
    'SELECT id,title,body,severity,action_path,read_at,created_at FROM notifications WHERE shop_id=$1 AND staff_id=$2 ORDER BY created_at DESC LIMIT 100',
    [actor.shopId, actor.id],
  );
}
