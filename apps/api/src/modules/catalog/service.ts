import {
  productSchema,
  categorySchema,
  contactSchema,
  customerSchema,
  type Actor,
  can,
} from '@agripos/shared';
import type { Database } from '../../database/db';
import { requirePermission, audit } from '../../services/transactions';
import { assert } from '../../utils/errors';
export async function createCategory(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'catalog.write');
  const data = categorySchema.parse(input);
  return (
    await db.query('INSERT INTO categories(shop_id,name,kind) VALUES($1,$2,$3) RETURNING *', [
      actor.shopId,
      data.name,
      data.kind,
    ])
  )[0];
}
export async function saveProduct(db: Database, actor: Actor, input: unknown, productId?: string) {
  requirePermission(actor, 'catalog.write');
  const p = productSchema.parse(input);
  return db.transaction(async (tx) => {
    if (productId) {
      const old = (
        await tx.query('SELECT * FROM products WHERE shop_id=$1 AND id=$2 FOR UPDATE', [
          actor.shopId,
          productId,
        ])
      )[0];
      assert(old, 404, 'NOT_FOUND', 'Product not found');
      if (old.unit !== p.unit) {
        const used = (
          await tx.query('SELECT id FROM batches WHERE product_id=$1 LIMIT 1', [productId])
        )[0];
        assert(
          !used,
          409,
          'UNIT_HISTORY',
          'The base unit cannot change after stock has been received',
        );
      }
      if (old.selling_price !== p.sellingPrice || old.tax_bps !== p.taxBps)
        requirePermission(actor, 'price.write');
    } else requirePermission(actor, 'price.write');
    const values = [
      actor.shopId,
      p.name,
      p.sku,
      p.barcode || null,
      p.categoryId,
      p.supplierId,
      p.brand,
      p.description,
      p.unit,
      p.sellingPrice,
      p.purchasePrice,
      p.taxBps,
      p.minimumStock,
      p.active,
      JSON.stringify(p.attributes),
    ];
    const rows = productId
      ? await tx.query(
          'UPDATE products SET name=$2,sku=$3,barcode=$4,category_id=$5,supplier_id=$6,brand=$7,description=$8,unit=$9,selling_price=$10,purchase_price=$11,tax_bps=$12,minimum_stock=$13,active=$14,attributes=$15,updated_at=now() WHERE shop_id=$1 AND id=$16 RETURNING *',
          [...values, productId],
        )
      : await tx.query(
          'INSERT INTO products(shop_id,name,sku,barcode,category_id,supplier_id,brand,description,unit,selling_price,purchase_price,tax_bps,minimum_stock,active,attributes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *',
          values,
        );
    const row = rows[0]!;
    await tx.query(
      'UPDATE products SET purchase_unit=$2,purchase_factor=$3,reorder_quantity=$4,subcategory=$5 WHERE id=$1',
      [row.id, p.purchaseUnit ?? p.unit, p.purchaseFactor, p.reorderQuantity, p.subcategory],
    );
    await audit(tx, actor, productId ? 'product.update' : 'product.create', String(row.id), p);
    return Object.assign(row, {
      purchase_unit: p.purchaseUnit ?? p.unit,
      purchase_factor: p.purchaseFactor,
      reorder_quantity: p.reorderQuantity,
      subcategory: p.subcategory,
    });
  });
}
export async function saveContact(
  db: Database,
  actor: Actor,
  kind: 'suppliers' | 'customers',
  input: unknown,
  contactId?: string,
) {
  requirePermission(actor, kind === 'suppliers' ? 'purchases.write' : 'customers.write');
  const p = kind === 'customers' ? customerSchema.parse(input) : contactSchema.parse(input);
  return db.transaction(async (tx) => {
    const credit = 'creditLimit' in p ? p.creditLimit : 0;
    if (kind === 'customers') {
      const old = contactId
        ? (
            await tx.query(
              'SELECT credit_limit,credit_enabled FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE',
              [actor.shopId, contactId],
            )
          )[0]
        : null;
      if (credit !== (old?.credit_limit ?? 0)) requirePermission(actor, 'credit.manage');
      if ('creditEnabled' in p && p.creditEnabled !== (old?.credit_enabled ?? true))
        requirePermission(actor, 'credit.manage');
    }
    const params: unknown[] = [actor.shopId, p.name, p.phone, p.email, p.address];
    if (kind === 'customers') params.push(credit);
    const rows = contactId
      ? await tx.query(
          `UPDATE ${kind} SET name=$2,phone=$3,email=$4,address=$5${kind === 'customers' ? ',credit_limit=$6' : ''} WHERE shop_id=$1 AND id=$${params.length + 1} RETURNING *`,
          [...params, contactId],
        )
      : await tx.query(
          `INSERT INTO ${kind}(shop_id,name,phone,email,address${kind === 'customers' ? ',credit_limit' : ''}) VALUES(${params.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
          params,
        );
    assert(rows[0], 404, 'NOT_FOUND', 'Contact not found');
    await tx.query(`UPDATE ${kind} SET active=$2 WHERE id=$1`, [rows[0].id, p.active]);
    if ('creditEnabled' in p)
      await tx.query('UPDATE customers SET credit_enabled=$2 WHERE id=$1', [
        rows[0].id,
        p.creditEnabled,
      ]);
    await audit(tx, actor, `${kind}.save`, String(rows[0].id));
    return rows[0];
  });
}
export async function products(db: Database, actor: Actor, search = '', limit = 25, page = 1) {
  requirePermission(actor, 'catalog.read');
  const rows = await db.query(
    `SELECT p.*,c.name category,c.kind,
    COALESCE((SELECT SUM(b.quantity)::bigint FROM batches b WHERE b.product_id=p.id AND (b.expiry_date IS NULL OR b.expiry_date >= (now() AT TIME ZONE 'Asia/Colombo')::date)),0)::bigint stock,
    COUNT(*) OVER()::int row_count FROM products p JOIN categories c ON c.id=p.category_id
    WHERE p.shop_id=$1 AND (p.name ILIKE $2 OR p.sku ILIKE $2 OR p.barcode ILIKE $2) ORDER BY p.name,p.id LIMIT $3 OFFSET $4`,
    [actor.shopId, `%${search}%`, limit, (page - 1) * limit],
  );
  return {
    items: rows.map((row) => {
      if (!can(actor.role, 'cost.read')) delete row.purchase_price;
      return row;
    }),
    total: rows[0]?.row_count ?? 0,
    page,
    limit,
  };
}
