import { conversionSchema, multiply, stockReceiptSchema, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { audit, command, requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';

const today = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }).replaceAll('-', '');

/** Adds stock without a purchase order. Supplier balances are unchanged; use Purchases for invoices. */
export async function receiveStock(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'inventory.write');
  const p = stockReceiptSchema.parse(input);
  return command(db, actor, p.operationId, 'stock.receipt', p, async (tx) => {
    const product = (
      await tx.query<{ purchase_price: number; whole_units: boolean; unit: string; name: string }>(
        'SELECT purchase_price,whole_units,unit,name FROM products WHERE shop_id=$1 AND id=$2 FOR UPDATE',
        [actor.shopId, p.productId],
      )
    )[0];
    assert(product, 404, 'NOT_FOUND', 'Product not found');
    assert(
      !product.whole_units || p.quantity % 1000 === 0,
      422,
      'WHOLE_UNITS',
      `${product.name} is stocked in whole ${product.unit}s`,
    );
    const batch = (
      await tx.query<{ id: string }>(
        'INSERT INTO batches(shop_id,product_id,batch_number,expiry_date,quantity,unit_cost,supplier_id,received_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$5) RETURNING id',
        [
          actor.shopId,
          p.productId,
          p.batchNumber || `RCV-${today()}`,
          p.expiryDate,
          p.quantity,
          p.unitCost ?? product.purchase_price,
          p.supplierId,
        ],
      )
    )[0]!;
    await tx.query(
      "INSERT INTO inventory_movements(shop_id,batch_id,delta,type,reason,reference_id,actor_id) VALUES($1,$2,$3,'stock_receipt',$4,$5,$6)",
      [actor.shopId, batch.id, p.quantity, p.notes || 'Stock received', p.operationId, actor.id],
    );
    await audit(tx, actor, 'inventory.receipt', p.productId, p);
    return { id: batch.id, productId: p.productId, quantity: p.quantity };
  });
}

/** Opens sealed stock into another variant (for example 1 x 50 kg bag into 50 kg loose). */
export async function convertStock(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'inventory.write');
  const p = conversionSchema.parse(input);
  return command(db, actor, p.operationId, 'stock.conversion', p, async (tx) => {
    const products = await tx.query<{
      id: string;
      name: string;
      unit: string;
      whole_units: boolean;
      family_id: string | null;
    }>(
      'SELECT id,name,unit,whole_units,family_id FROM products WHERE shop_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE',
      [actor.shopId, [p.fromProductId, p.toProductId]],
    );
    const from = products.find((x) => x.id === p.fromProductId),
      to = products.find((x) => x.id === p.toProductId);
    assert(from && to, 404, 'NOT_FOUND', 'Product not found');
    assert(
      from.family_id !== null && from.family_id === to.family_id,
      422,
      'CONVERSION_FAMILY',
      'Stock can only be converted between variants of the same product',
    );
    for (const [product, quantity] of [
      [from, p.quantity],
      [to, p.resultingQuantity],
    ] as const)
      assert(
        !product.whole_units || quantity % 1000 === 0,
        422,
        'WHOLE_UNITS',
        `${product.name} uses whole ${product.unit}s`,
      );
    const batches = await tx.query<{
      id: string;
      quantity: number;
      unit_cost: number;
      expiry_date: string | null;
    }>(
      "SELECT id,quantity,unit_cost,expiry_date::text expiry_date FROM batches WHERE shop_id=$1 AND product_id=$2 AND quantity>0 AND (expiry_date IS NULL OR expiry_date>=(now() AT TIME ZONE 'Asia/Colombo')::date) ORDER BY expiry_date NULLS LAST,created_at,id FOR UPDATE",
      [actor.shopId, p.fromProductId],
    );
    let remaining = p.quantity,
      cost = 0,
      expiry: string | null = null;
    for (const batch of batches) {
      if (!remaining) break;
      const take = Math.min(remaining, batch.quantity);
      remaining -= take;
      cost += multiply(batch.unit_cost, take);
      if (batch.expiry_date && (!expiry || batch.expiry_date < expiry)) expiry = batch.expiry_date;
      await tx.query('UPDATE batches SET quantity=quantity-$1 WHERE id=$2', [take, batch.id]);
      await tx.query(
        "INSERT INTO inventory_movements(shop_id,batch_id,delta,type,reason,reference_id,actor_id) VALUES($1,$2,$3,'conversion_out',$4,$5,$6)",
        [actor.shopId, batch.id, -take, p.reason, p.operationId, actor.id],
      );
    }
    assert(!remaining, 409, 'INSUFFICIENT_STOCK', `Not enough sellable stock for ${from.name}`);
    const unitCost = Number(
      (BigInt(cost) * 1000n + BigInt(p.resultingQuantity) / 2n) / BigInt(p.resultingQuantity),
    );
    const batch = (
      await tx.query<{ id: string }>(
        'INSERT INTO batches(shop_id,product_id,batch_number,expiry_date,quantity,unit_cost,received_quantity) VALUES($1,$2,$3,$4,$5,$6,$5) RETURNING id',
        [actor.shopId, p.toProductId, `CONV-${today()}`, expiry, p.resultingQuantity, unitCost],
      )
    )[0]!;
    await tx.query(
      "INSERT INTO inventory_movements(shop_id,batch_id,delta,type,reason,reference_id,actor_id) VALUES($1,$2,$3,'conversion_in',$4,$5,$6)",
      [actor.shopId, batch.id, p.resultingQuantity, p.reason, p.operationId, actor.id],
    );
    await tx.query(
      'INSERT INTO stock_conversions(id,shop_id,from_product_id,to_product_id,quantity,resulting_quantity,cost,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        p.operationId,
        actor.shopId,
        p.fromProductId,
        p.toProductId,
        p.quantity,
        p.resultingQuantity,
        cost,
        p.reason,
        actor.id,
      ],
    );
    await audit(tx, actor, 'inventory.conversion', p.fromProductId, p);
    return { id: p.operationId, cost, batchId: batch.id };
  });
}

/** Every movement for a product with the stock balance after it, derived from the ledger. */
export async function stockHistory(db: Database, actor: Actor, productId: string) {
  requirePermission(actor, 'catalog.read');
  return db.query(
    `SELECT * FROM (SELECT m.id,m.created_at,m.type,m.delta,m.reason,m.reference_id,b.batch_number,st.name actor,
       (SUM(m.delta) OVER(ORDER BY m.created_at,m.id)-m.delta)::bigint previous,
       SUM(m.delta) OVER(ORDER BY m.created_at,m.id)::bigint balance,
       (SELECT s.invoice_number FROM sales s WHERE s.id=m.reference_id) invoice_number
      FROM inventory_movements m JOIN batches b ON b.id=m.batch_id JOIN staff st ON st.id=m.actor_id
      WHERE m.shop_id=$1 AND b.product_id=$2) t ORDER BY created_at DESC,id DESC LIMIT 1000`,
    [actor.shopId, productId],
  );
}
