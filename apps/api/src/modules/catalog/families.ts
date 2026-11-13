import {
  driverDiscountSchema,
  familySchema,
  familyUpdateSchema,
  variantSchema,
  type Actor,
} from '@agripos/shared';
import type { Connection, Database } from '../../database/db';
import { audit, requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
import type { z } from 'zod';

const variantName = (family: string, label: string) => `${family} — ${label}`;

async function insertVariant(
  tx: Connection,
  actor: Actor,
  family: { id: string; name: string; category_id: string; brand: string; description: string },
  variant: z.infer<typeof variantSchema>,
  taxBps: number,
) {
  const product = (
    await tx.query(
      'INSERT INTO products(shop_id,name,sku,barcode,category_id,brand,description,unit,selling_price,purchase_price,tax_bps,minimum_stock,active,family_id,variant_label,whole_units,purchase_unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$8) RETURNING *',
      [
        actor.shopId,
        variantName(family.name, variant.label),
        variant.sku,
        variant.barcode || null,
        family.category_id,
        family.brand,
        family.description,
        variant.unit,
        variant.sellingPrice,
        variant.purchasePrice,
        taxBps,
        variant.minimumStock,
        variant.active,
        family.id,
        variant.label,
        variant.wholeUnits,
      ],
    )
  )[0]!;
  if (variant.driverDiscount > 0)
    await tx.query(
      'INSERT INTO driver_discounts(shop_id,product_id,amount,updated_by) VALUES($1,$2,$3,$4)',
      [actor.shopId, product.id, variant.driverDiscount, actor.id],
    );
  return product;
}

export async function createFamily(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'catalog.write');
  requirePermission(actor, 'price.write');
  const p = familySchema.parse(input);
  assert(
    new Set(p.variants.map((v) => v.label.toLowerCase())).size === p.variants.length,
    422,
    'DUPLICATE_VARIANT',
    'Give each variant a different size or label',
  );
  return db.transaction(async (tx) => {
    const family = (
      await tx.query<{
        id: string;
        name: string;
        category_id: string;
        brand: string;
        description: string;
      }>(
        'INSERT INTO product_families(shop_id,name,category_id,brand,description) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [actor.shopId, p.name, p.categoryId, p.brand, p.description],
      )
    )[0]!;
    const variants = [];
    for (const variant of p.variants)
      variants.push(await insertVariant(tx, actor, family, variant, p.taxBps));
    await audit(tx, actor, 'product_family.create', family.id, p);
    return { ...family, variants };
  });
}

export async function addVariant(db: Database, actor: Actor, familyId: string, input: unknown) {
  requirePermission(actor, 'catalog.write');
  requirePermission(actor, 'price.write');
  const v = variantSchema.parse(input);
  return db.transaction(async (tx) => {
    const family = (
      await tx.query<{
        id: string;
        name: string;
        category_id: string;
        brand: string;
        description: string;
      }>('SELECT * FROM product_families WHERE shop_id=$1 AND id=$2 FOR UPDATE', [
        actor.shopId,
        familyId,
      ])
    )[0];
    assert(family, 404, 'NOT_FOUND', 'Product not found');
    const tax = (
      await tx.query<{ tax_bps: number }>(
        'SELECT tax_bps FROM products WHERE family_id=$1 ORDER BY created_at LIMIT 1',
        [familyId],
      )
    )[0]?.tax_bps;
    const product = await insertVariant(tx, actor, family, v, tax ?? 0);
    await audit(tx, actor, 'product_family.variant', String(product.id), v);
    return product;
  });
}

export async function updateFamily(db: Database, actor: Actor, familyId: string, input: unknown) {
  requirePermission(actor, 'catalog.write');
  const p = familyUpdateSchema.parse(input);
  return db.transaction(async (tx) => {
    const family = (
      await tx.query(
        'UPDATE product_families SET name=$3,category_id=$4,brand=$5,description=$6 WHERE shop_id=$1 AND id=$2 RETURNING *',
        [actor.shopId, familyId, p.name, p.categoryId, p.brand, p.description],
      )
    )[0];
    assert(family, 404, 'NOT_FOUND', 'Product not found');
    await tx.query(
      "UPDATE products SET name=$3||' — '||variant_label,category_id=$4,brand=$5,description=$6,updated_at=now() WHERE shop_id=$1 AND family_id=$2",
      [actor.shopId, familyId, p.name, p.categoryId, p.brand, p.description],
    );
    await audit(tx, actor, 'product_family.update', familyId, p);
    return family;
  });
}

export async function listFamilies(db: Database, actor: Actor) {
  requirePermission(actor, 'catalog.read');
  return db.query(
    'SELECT f.*,(SELECT COUNT(*)::int FROM products p WHERE p.family_id=f.id) variants FROM product_families f WHERE f.shop_id=$1 ORDER BY f.name',
    [actor.shopId],
  );
}

export async function listDriverDiscounts(db: Database, actor: Actor) {
  requirePermission(actor, 'catalog.read');
  return db.query(
    `SELECT p.id product_id,p.name,p.sku,p.unit,p.variant_label,f.name family,p.selling_price,COALESCE(d.amount,0)::bigint amount,d.updated_at
     FROM products p LEFT JOIN product_families f ON f.id=p.family_id LEFT JOIN driver_discounts d ON d.product_id=p.id AND d.shop_id=p.shop_id
     WHERE p.shop_id=$1 AND p.active ORDER BY (d.amount IS NULL), COALESCE(f.name,p.name), p.variant_label`,
    [actor.shopId],
  );
}

export async function setDriverDiscount(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'price.write');
  const p = driverDiscountSchema.parse(input);
  return db.transaction(async (tx) => {
    const product = (
      await tx.query<{ selling_price: number }>(
        'SELECT selling_price FROM products WHERE shop_id=$1 AND id=$2',
        [actor.shopId, p.productId],
      )
    )[0];
    assert(product, 404, 'NOT_FOUND', 'Product not found');
    assert(
      p.amount <= product.selling_price,
      422,
      'INVALID_DISCOUNT',
      'A per-unit discount cannot exceed the selling price',
    );
    const row = (
      await tx.query(
        'INSERT INTO driver_discounts(shop_id,product_id,amount,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(shop_id,product_id) DO UPDATE SET amount=excluded.amount,updated_by=excluded.updated_by,updated_at=now() RETURNING *',
        [actor.shopId, p.productId, p.amount, actor.id],
      )
    )[0];
    await audit(tx, actor, 'driver_discount.set', p.productId, p);
    return row;
  });
}
