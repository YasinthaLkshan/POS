import {
  saleSchema,
  lineTotals,
  multiply,
  safeInteger,
  allocateDiscount,
  type Actor,
} from '@agripos/shared';
import type { Database } from '../../database/db';
import { audit, command, requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
import { cashMovement } from '../finance/cash';
import type { OfflineContext } from '../sync/service';
interface Product extends Record<string, unknown> {
  id: string;
  name: string;
  selling_price: number;
  tax_bps: number;
  active: boolean;
}
interface Batch extends Record<string, unknown> {
  id: string;
  quantity: number;
  unit_cost: number;
}
export async function createSale(
  db: Database,
  actor: Actor,
  input: unknown,
  offline?: OfflineContext,
) {
  requirePermission(actor, 'sales.write');
  const p = saleSchema.parse(input);
  assert(
    new Set(p.lines.map((l) => l.productId)).size === p.lines.length,
    422,
    'DUPLICATE_LINE',
    'Combine duplicate cart lines',
  );
  if (p.lines.some((l) => l.discount > 0) || (p.orderDiscount ?? 0) > 0)
    requirePermission(actor, 'discount.approve');
  return command(
    db,
    actor,
    p.operationId,
    'sale',
    { ...p, offlineGrantId: offline?.grant.id },
    async (tx) => {
      if (p.parkedId) {
        const parked = (
          await tx.query<{ status: string; claimed_by: string }>(
            'SELECT status,claimed_by FROM parked_sales WHERE shop_id=$1 AND id=$2 FOR UPDATE',
            [actor.shopId, p.parkedId],
          )
        )[0];
        assert(
          parked?.status === 'resumed' && parked.claimed_by === actor.id,
          409,
          'PARKED_SALE_UNAVAILABLE',
          'Resume this parked sale before checkout',
        );
      }
      let subtotal = 0,
        discount = 0,
        tax = 0,
        total = 0,
        cost = 0;
      const lines = [];
      const catalog = new Map<string, Product>();
      for (const line of p.lines) {
        const product = (
          await tx.query<Product>('SELECT * FROM products WHERE shop_id=$1 AND id=$2 FOR UPDATE', [
            actor.shopId,
            line.productId,
          ])
        )[0];
        assert(product?.active, 409, 'UNAVAILABLE_PRODUCT', 'A product is unavailable');
        if (offline) {
          const snapshot = offline.grant.products.find((p) => p.id === line.productId);
          assert(
            snapshot,
            409,
            'SNAPSHOT_MISMATCH',
            'Product is absent from offline authorization',
          );
          product.selling_price = snapshot.selling_price;
          product.tax_bps = snapshot.tax_bps;
          product.name = snapshot.name;
        }
        catalog.set(line.productId, product);
      }
      const bases = p.lines.map(
        (l) => multiply(catalog.get(l.productId)!.selling_price, l.quantity) - l.discount,
      );
      assert(
        bases.every((n) => n >= 0) && (p.orderDiscount ?? 0) <= bases.reduce((s, n) => s + n, 0),
        422,
        'INVALID_DISCOUNT',
        'Discount exceeds the current subtotal',
      );
      const apportioned = allocateDiscount(p.orderDiscount ?? 0, bases),
        discounts = new Map(p.lines.map((l, i) => [l.productId, apportioned[i]!]));
      for (const original of [...p.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const line = {
          ...original,
          discount: original.discount + discounts.get(original.productId)!,
        };
        const product = catalog.get(line.productId)!;
        assert(product?.active, 409, 'UNAVAILABLE_PRODUCT', 'A product is unavailable');
        if (offline) {
          const snapshot = offline.grant.products.find((item) => item.id === product.id);
          assert(
            snapshot,
            409,
            'SNAPSHOT_MISMATCH',
            'Product is absent from offline authorization',
          );
          product.selling_price = snapshot.selling_price;
          product.tax_bps = snapshot.tax_bps;
          product.name = snapshot.name;
        }
        assert(
          line.discount <= multiply(product.selling_price, line.quantity),
          422,
          'INVALID_DISCOUNT',
          'Discount exceeds the current line subtotal',
        );
        const totals = lineTotals(
          product.selling_price,
          line.quantity,
          line.discount,
          product.tax_bps,
        );
        const batches = await tx.query<Batch>(
          "SELECT * FROM batches WHERE shop_id=$1 AND product_id=$2 AND quantity>0 AND (expiry_date IS NULL OR expiry_date >= COALESCE(($3::timestamptz AT TIME ZONE 'Asia/Colombo')::date,(now() AT TIME ZONE 'Asia/Colombo')::date)) AND ($4::uuid[] IS NULL OR id=ANY($4::uuid[])) ORDER BY expiry_date NULLS LAST,created_at,id FOR UPDATE",
          [
            actor.shopId,
            line.productId,
            offline?.operation.createdAt ?? null,
            offline
              ? offline.operation.allocations
                  .filter((a) => a.productId === line.productId)
                  .map((a) => a.batchId)
              : null,
          ],
        );
        let remaining = line.quantity,
          lineCost = 0;
        const allocations = [];
        for (const batch of batches) {
          if (remaining === 0) break;
          const quantity = offline
            ? offline.operation.allocations.find((a) => a.batchId === batch.id)!.quantity
            : Math.min(remaining, batch.quantity);
          assert(
            quantity <= batch.quantity,
            409,
            'OFFLINE_STOCK_CONFLICT',
            'The allocated offline batch no longer has sufficient cloud stock',
          );
          if (offline) {
            const used = (
              await tx.query<{ used: number }>(
                "SELECT COALESCE(SUM((a.value->>'quantity')::bigint),0)::bigint used FROM sync_operations o CROSS JOIN LATERAL jsonb_array_elements(o.payload->'allocations') a WHERE o.grant_id=$1 AND o.id<>$2 AND a.value->>'batchId'=$3 AND EXISTS(SELECT 1 FROM sales s WHERE s.id=o.id)",
                [offline.grant.id, p.operationId, batch.id],
              )
            )[0]!.used;
            const authorized = offline.grant.batches.find((b) => b.id === batch.id)!.quantity;
            assert(
              used + quantity <= authorized,
              409,
              'OFFLINE_BUDGET',
              'Receipts exceed this grant’s batch stock allowance',
            );
          }
          remaining -= quantity;
          lineCost += multiply(batch.unit_cost, quantity);
          allocations.push({
            batchId: batch.id,
            quantity,
            cost: multiply(batch.unit_cost, quantity),
          });
        }
        assert(
          remaining === 0,
          409,
          'INSUFFICIENT_STOCK',
          `Not enough sellable stock for ${product.name}`,
        );
        subtotal += totals.subtotal;
        discount += totals.discount;
        tax += totals.tax;
        total += totals.total;
        cost += lineCost;
        lines.push({ product, line, totals, lineCost, allocations });
      }
      [subtotal, total, cost].forEach((n) => safeInteger(BigInt(n)));
      const paid = p.payments.reduce((sum, x) => sum + x.amount, 0),
        credit = total - paid;
      assert(
        credit >= 0,
        422,
        'OVERPAYMENT',
        'Payment allocation exceeds total; enter cash received separately',
      );
      if (credit > 0) {
        assert(
          p.customerId && p.dueDate,
          422,
          'CREDIT_DETAILS',
          'Select a customer and due date for unpaid amounts',
        );
        const customer = (
          await tx.query<{ credit_limit: number; active: boolean; credit_enabled: boolean }>(
            'SELECT credit_limit,active,credit_enabled FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE',
            [actor.shopId, p.customerId],
          )
        )[0];
        assert(customer, 404, 'NOT_FOUND', 'Customer not found');
        assert(
          customer.active && customer.credit_enabled,
          409,
          'CREDIT_DISABLED',
          'This customer is not eligible for new credit',
        );
        const balance = (
          await tx.query<{ balance: number }>(
            'SELECT COALESCE(SUM(amount),0)::bigint balance FROM customer_ledger WHERE shop_id=$1 AND customer_id=$2',
            [actor.shopId, p.customerId],
          )
        )[0]!.balance;
        assert(
          balance + credit <= customer.credit_limit,
          409,
          'CREDIT_LIMIT',
          'Customer credit limit would be exceeded',
        );
      }
      const cash = p.payments
        .filter((x) => x.method === 'cash')
        .reduce((sum, x) => sum + x.amount, 0);
      const tendered = p.cashTendered ?? cash;
      assert(
        tendered >= cash && (cash > 0 || tendered === 0),
        422,
        'CASH_TENDER',
        'Cash received must cover the cash payment',
      );
      await tx.query(
        'INSERT INTO sales(id,shop_id,terminal_id,customer_id,cashier_id,subtotal,discount,tax,total,cost,credit,cash_tendered,change,due_date,invoice_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
        [
          p.operationId,
          actor.shopId,
          p.terminalId,
          p.customerId,
          actor.id,
          subtotal,
          discount,
          tax,
          total,
          cost,
          credit,
          tendered,
          tendered - cash,
          p.dueDate,
          `${offline?.grant.shop.invoice_prefix ?? (await tx.query<{ invoice_prefix: string }>('SELECT invoice_prefix FROM shops WHERE id=$1', [actor.shopId]))[0]!.invoice_prefix}-${p.operationId.toUpperCase()}`,
        ],
      );
      for (const entry of lines) {
        await tx.query(
          'INSERT INTO sale_lines(shop_id,sale_id,product_id,name,quantity,unit_price,discount,tax,total,cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            actor.shopId,
            p.operationId,
            entry.product.id,
            entry.product.name,
            entry.line.quantity,
            entry.product.selling_price,
            entry.line.discount,
            entry.totals.tax,
            entry.totals.total,
            entry.lineCost,
          ],
        );
        for (const allocation of entry.allocations) {
          await tx.query('UPDATE batches SET quantity=quantity-$1 WHERE id=$2', [
            allocation.quantity,
            allocation.batchId,
          ]);
          await tx.query(
            'INSERT INTO sale_allocations(shop_id,sale_id,batch_id,quantity,cost) VALUES($1,$2,$3,$4,$5)',
            [actor.shopId, p.operationId, allocation.batchId, allocation.quantity, allocation.cost],
          );
          await tx.query(
            "INSERT INTO inventory_movements(shop_id,batch_id,delta,type,reason,reference_id,actor_id) VALUES($1,$2,$3,'sale','Completed sale',$4,$5)",
            [actor.shopId, allocation.batchId, -allocation.quantity, p.operationId, actor.id],
          );
        }
      }
      for (const payment of p.payments)
        await tx.query(
          'INSERT INTO payments(shop_id,sale_id,method,amount,reference) VALUES($1,$2,$3,$4,$5)',
          [actor.shopId, p.operationId, payment.method, payment.amount, payment.reference],
        );
      if (credit > 0)
        await tx.query(
          "INSERT INTO customer_ledger(shop_id,customer_id,sale_id,amount,type,actor_id) VALUES($1,$2,$3,$4,'credit_sale',$5)",
          [actor.shopId, p.customerId, p.operationId, credit, actor.id],
        );
      await cashMovement(
        tx,
        offline?.reconciler ?? actor,
        offline?.reconcileTerminalId ?? p.terminalId,
        cash,
        'sale',
        p.operationId,
        offline ? 'Synchronized offline cash receipt' : 'Cash sale',
      );
      if (offline)
        await tx.query('UPDATE sales SET created_at=$2 WHERE id=$1', [
          p.operationId,
          offline.operation.createdAt,
        ]);
      if (p.parkedId)
        await tx.query("UPDATE parked_sales SET status='completed',updated_at=now() WHERE id=$1", [
          p.parkedId,
        ]);
      await audit(tx, actor, 'sale.complete', p.operationId, { total, credit });
      return { id: p.operationId, total, subtotal, discount, tax, credit, change: tendered - cash };
    },
  );
}
export { returnSale } from './returns';
