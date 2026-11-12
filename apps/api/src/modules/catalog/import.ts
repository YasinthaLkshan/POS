import { z } from 'zod';
import { id, parseCsv, decimalToInteger, productSchema, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { command, requirePermission } from '../../services/transactions';
import { assert, AppError } from '../../utils/errors';
import { saveProduct } from './service';
const schema = z.object({ operationId: id, csv: z.string().min(1).max(200000) }).strict();
export async function importProducts(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'catalog.write');
  requirePermission(actor, 'price.write');
  const p = schema.parse(input);
  let rows: Record<string, string>[];
  try {
    rows = parseCsv(p.csv);
  } catch (e) {
    throw new AppError(422, 'CSV_INVALID', e instanceof Error ? e.message : 'Invalid CSV');
  }
  assert(
    rows.length > 0 && rows.length <= 200,
    422,
    'CSV_LIMIT',
    'Import between 1 and 200 products per file',
  );
  return command(db, actor, p.operationId, 'products.import', p, async (tx) => {
    const categories = await tx.query<{ id: string; name: string }>(
      'SELECT id,name FROM categories WHERE shop_id=$1',
      [actor.shopId],
    );
    const parsed = rows.map((r, index) => {
      try {
        const category = categories.find((c) => c.name.toLowerCase() === r.category?.toLowerCase());
        assert(
          category,
          422,
          'CSV_CATEGORY',
          `Row ${index + 2}: category "${r.category}" was not found`,
        );
        return productSchema.parse({
          name: r.name,
          sku: r.sku,
          barcode: r.barcode || null,
          categoryId: category.id,
          unit: r.unit || 'piece',
          sellingPrice: decimalToInteger(r.selling_price ?? ''),
          purchasePrice: decimalToInteger(r.purchase_price ?? ''),
          minimumStock: decimalToInteger(r.minimum_stock || '0', 3),
          taxBps: decimalToInteger(r.tax_percent || '0'),
          brand: r.brand || '',
          description: r.description || '',
        });
      } catch (e) {
        throw new AppError(
          422,
          'CSV_ROW',
          `Row ${index + 2}: ${e instanceof Error ? e.message : 'Invalid product'}`,
        );
      }
    });
    const nested: Database = {
      query: tx.query,
      transaction: (fn) => fn(tx),
      close: async () => {},
    };
    for (const product of parsed) await saveProduct(nested, actor, product);
    return { imported: parsed.length };
  });
}
