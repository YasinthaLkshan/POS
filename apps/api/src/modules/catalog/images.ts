import type { Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { requirePermission, audit } from '../../services/transactions';
import { assert } from '../../utils/errors';

/** The image bytes live on each desktop. PostgreSQL records only that a local image was added. */
export async function productImage(db: Database, actor: Actor, productId: string, input?: unknown) {
  const logo = productId === 'logo';
  requirePermission(
    actor,
    input === undefined ? 'catalog.read' : logo ? 'settings.write' : 'catalog.write',
  );
  if (input === undefined) return { dataUrl: null };
  assert(
    input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      Object.keys(input).length === 1 &&
      Reflect.get(input, 'local') === true,
    422,
    'IMAGE_LOCAL_ONLY',
    'Images must be saved on the desktop',
  );
  const path = `local/${productId}`;
  await db.transaction(async (tx) => {
    const rows = logo
      ? await tx.query('UPDATE shops SET logo_path=$2 WHERE id=$1 RETURNING id', [
          actor.shopId,
          path,
        ])
      : await tx.query(
          'UPDATE products SET image_path=$3,updated_at=now() WHERE shop_id=$1 AND id=$2 RETURNING id',
          [actor.shopId, productId, path],
        );
    assert(rows.length, 404, 'NOT_FOUND', 'Product or shop not found');
    await audit(tx, actor, logo ? 'shop.logo' : 'product.image', logo ? actor.shopId : productId);
  });
  return { saved: true };
}
