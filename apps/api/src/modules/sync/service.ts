import { randomUUID, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import {
  can,
  lineTotals,
  offlineOperationSchema,
  type Actor,
  type OfflineGrant,
  type OfflineOperation,
  type SyncResult,
} from '@agripos/shared';
import type { Database } from '../../database/db';
import { requirePermission, audit } from '../../services/transactions';
import { assert, AppError } from '../../utils/errors';
import { createSale } from '../sales/service';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function provisionOffline(
  db: Database,
  actor: Actor,
  terminalId: string,
  secret: string | undefined,
): Promise<OfflineGrant> {
  requirePermission(actor, 'sales.write');
  assert(
    secret && secret.length >= 32,
    503,
    'OFFLINE_NOT_CONFIGURED',
    'Your administrator must configure the offline signing key',
  );
  return db.transaction(async (tx) => {
    await tx.query('SELECT id FROM shops WHERE id=$1 FOR UPDATE', [actor.shopId]);
    const terminal = (
      await tx.query(
        'SELECT id FROM terminals WHERE shop_id=$1 AND id=$2 AND offline_enabled=true',
        [actor.shopId, terminalId],
      )
    )[0];
    assert(
      terminal,
      403,
      'TERMINAL_NOT_AUTHORIZED',
      'An administrator must authorize this terminal for offline use',
    );
    const session = (
      await tx.query<{ id: string }>(
        'SELECT id FROM cash_sessions WHERE shop_id=$1 AND terminal_id=$2 AND closed_at IS NULL',
        [actor.shopId, terminalId],
      )
    )[0];
    const shop = (
      await tx.query<{
        name: string;
        address: string;
        phone: string;
        receipt_footer: string;
        require_cash_session: boolean;
      }>('SELECT * FROM shops WHERE id=$1', [actor.shopId])
    )[0]!;
    assert(
      session || !shop.require_cash_session,
      409,
      'CASH_SESSION_REQUIRED',
      'Open a cash register before provisioning offline access',
    );
    const grantId = randomUUID(),
      issuedAt = new Date().toISOString(),
      expiresAt = new Date(Date.now() + 12 * 3600000).toISOString();
    const token = createHmac('sha256', secret)
      .update(`${grantId}|${actor.id}|${terminalId}|${expiresAt}`)
      .digest('hex');
    const products = await tx.query(
      `SELECT p.id,p.name,p.sku,p.barcode,p.category_id,c.name category,c.kind,p.unit,p.selling_price,p.tax_bps,p.minimum_stock,p.active,p.brand,p.description,p.attributes,COALESCE((SELECT SUM(b.quantity)::bigint FROM batches b WHERE b.product_id=p.id AND (b.expiry_date IS NULL OR b.expiry_date>=(now() AT TIME ZONE 'Asia/Colombo')::date)),0)::bigint stock FROM products p JOIN categories c ON c.id=p.category_id WHERE p.shop_id=$1 AND p.active ORDER BY p.id`,
      [actor.shopId],
    );
    assert(
      products.length <= 10000,
      409,
      'CATALOG_TOO_LARGE',
      'Contact your administrator to provision catalogs above 10,000 products',
    );
    const batches = await tx.query(
      "SELECT id,product_id,quantity,expiry_date FROM batches WHERE shop_id=$1 AND quantity>0 AND (expiry_date IS NULL OR expiry_date>=(now() AT TIME ZONE 'Asia/Colombo')::date) ORDER BY expiry_date NULLS LAST,created_at,id",
      [actor.shopId],
    );
    const categories = await tx.query(
      'SELECT id,name,kind FROM categories WHERE shop_id=$1 ORDER BY name',
      [actor.shopId],
    );
    const grant = {
      id: grantId,
      token,
      actor,
      terminalId,
      issuedAt,
      expiresAt,
      products,
      batches,
      categories,
      shop,
      cashSessionId: session?.id ?? null,
    } as unknown as OfflineGrant;
    await tx.query(
      'INSERT INTO offline_grants(id,shop_id,staff_id,terminal_id,token_hash,snapshot,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [grantId, actor.shopId, actor.id, terminalId, hash(token), JSON.stringify(grant), expiresAt],
    );
    await audit(tx, actor, 'offline.provision', terminalId, { grantId, expiresAt });
    return grant;
  });
}
export async function pushOffline(
  db: Database,
  uploader: Actor,
  input: unknown,
  reconcileTerminalId?: string,
): Promise<SyncResult> {
  requirePermission(uploader, 'sales.write');
  const operation = offlineOperationSchema.parse(input),
    saleId = operation.sale.operationId,
    fingerprint = hash(JSON.stringify(operation));
  const grantRow = (
    await db.query<{ snapshot: OfflineGrant; token_hash: string }>(
      'SELECT snapshot,token_hash FROM offline_grants WHERE shop_id=$1 AND id=$2',
      [uploader.shopId, operation.grantId],
    )
  )[0];
  assert(grantRow, 403, 'INVALID_GRANT', 'Offline authorization was not found');
  const grant = grantRow.snapshot;
  assert(
    timingSafeEqual(Buffer.from(hash(operation.grantToken)), Buffer.from(grantRow.token_hash)),
    403,
    'INVALID_GRANT',
    'Offline authorization is invalid',
  );
  assert(
    grant.actor.id === uploader.id || can(uploader.role, 'refund.write'),
    403,
    'OFFLINE_OWNER',
    'Only the original cashier or a manager can reconcile this receipt',
  );
  // Store the receipt durably before attempting reconciliation. A conflict never destroys it.
  const prior = await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM shops WHERE id=$1 FOR UPDATE', [uploader.shopId]);
    const row = (
      await tx.query<{ payload_hash: string; state: string; receipt: unknown; message: string }>(
        'SELECT * FROM sync_operations WHERE shop_id=$1 AND id=$2',
        [uploader.shopId, saleId],
      )
    )[0];
    if (row) {
      assert(
        row.payload_hash === fingerprint,
        409,
        'IDEMPOTENCY_CONFLICT',
        'Offline ID belongs to a different receipt',
      );
      return row;
    }
    await tx.query(
      "INSERT INTO sync_operations(id,shop_id,staff_id,grant_id,payload,payload_hash,state) VALUES($1,$2,$3,$4,$5,$6,'pending')",
      [saleId, uploader.shopId, grant.actor.id, grant.id, JSON.stringify(operation), fingerprint],
    );
    return null;
  });
  if (prior?.state === 'synced') return { id: saleId, state: 'synced', receipt: prior.receipt };
  const committed = (
    await db.query<{ payload_hash: string; kind: string; result: unknown }>(
      'SELECT payload_hash,kind,result FROM operations WHERE shop_id=$1 AND id=$2',
      [uploader.shopId, saleId],
    )
  )[0];
  if (
    committed?.kind === 'sale' &&
    committed.payload_hash === hash(JSON.stringify({ ...operation.sale, offlineGrantId: grant.id }))
  ) {
    await db.query(
      "UPDATE sync_operations SET state='synced',message='',receipt=$3,updated_at=now() WHERE shop_id=$1 AND id=$2",
      [uploader.shopId, saleId, JSON.stringify(committed.result)],
    );
    return { id: saleId, state: 'synced', receipt: committed.result };
  }
  try {
    const created = Date.parse(operation.createdAt);
    assert(
      created >= Date.parse(grant.issuedAt) &&
        created <= Date.parse(grant.expiresAt) &&
        created <= Date.now() + 300000,
      409,
      'OFFLINE_EXPIRED',
      'The receipt timestamp falls outside the offline authorization',
    );
    assert(
      operation.sale.terminalId === grant.terminalId &&
        !operation.sale.customerId &&
        !operation.sale.parkedId &&
        operation.sale.payments.length === 1 &&
        operation.sale.payments[0]?.method === 'cash' &&
        operation.sale.lines.every((l) => l.discount === 0) &&
        !(operation.sale.orderDiscount ?? 0),
      409,
      'OFFLINE_RESTRICTED',
      'Offline receipts must be cash-only, without credit, discounts or parked carts',
    );
    assert(
      new Set(operation.allocations.map((a) => a.batchId)).size === operation.allocations.length &&
        operation.allocations.every((a) =>
          operation.sale.lines.some((l) => l.productId === a.productId),
        ),
      409,
      'BATCH_MISMATCH',
      'Offline allocations contain duplicates or unrelated products',
    );
    const membership = (
      await db.query<{ active: boolean }>('SELECT active FROM staff WHERE id=$1 AND shop_id=$2', [
        grant.actor.id,
        uploader.shopId,
      ])
    )[0];
    assert(
      membership?.active,
      409,
      'STAFF_REVIEW',
      'Staff access changed; manager review is required',
    );
    let total = 0;
    for (const line of operation.sale.lines) {
      const p = grant.products.find((p) => p.id === line.productId);
      assert(p, 409, 'SNAPSHOT_MISMATCH', 'Product was not in the authorized catalog');
      total += lineTotals(p.selling_price, line.quantity, 0, p.tax_bps).total;
      const allocations = operation.allocations.filter((a) => a.productId === line.productId);
      assert(
        allocations.reduce((sum, a) => sum + a.quantity, 0) === line.quantity,
        409,
        'BATCH_MISMATCH',
        'Offline batch allocation does not match receipt quantity',
      );
      for (const a of allocations) {
        const b = grant.batches.find((b) => b.id === a.batchId && b.product_id === a.productId);
        assert(
          b && a.quantity <= b.quantity,
          409,
          'BATCH_MISMATCH',
          'Offline batch allocation exceeds its authorized snapshot',
        );
      }
    }
    assert(
      operation.sale.payments[0]?.amount === total,
      409,
      'TOTAL_MISMATCH',
      'Offline payment does not match the authorized prices',
    );
    if (grant.cashSessionId && !reconcileTerminalId) {
      const open = (
        await db.query('SELECT id FROM cash_sessions WHERE id=$1 AND closed_at IS NULL', [
          grant.cashSessionId,
        ])
      )[0];
      assert(
        open,
        409,
        'REGISTER_REVIEW',
        'The original register closed. A manager must choose an open register for reconciliation',
      );
    }
    if (reconcileTerminalId) requirePermission(uploader, 'refund.write');
    const receipt = await createSale(db, grant.actor, operation.sale, {
      grant,
      operation,
      reconcileTerminalId,
      reconciler: reconcileTerminalId ? uploader : undefined,
    });
    await db.query(
      "UPDATE sync_operations SET state='synced',message='',receipt=$3,updated_at=now() WHERE shop_id=$1 AND id=$2",
      [uploader.shopId, saleId, JSON.stringify(receipt)],
    );
    return { id: saleId, state: 'synced', receipt };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    await db.query(
      "UPDATE sync_operations SET state='conflict',message=$3,updated_at=now() WHERE shop_id=$1 AND id=$2 AND state<>'synced'",
      [uploader.shopId, saleId, error.message],
    );
    return { id: saleId, state: 'conflict', message: error.message };
  }
}
export type OfflineContext = {
  grant: OfflineGrant;
  operation: OfflineOperation;
  reconcileTerminalId?: string;
  reconciler?: Actor;
};
