import type { Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { requirePermission, audit } from '../../services/transactions';
import { assert } from '../../utils/errors';

/** Images share the local database and synchronize with the rest of the shop. */
export async function productImage(db: Database, actor: Actor, productId: string, input?: unknown) {
  const logo = productId === 'logo';
  requirePermission(
    actor,
    input === undefined ? 'catalog.read' : logo ? 'settings.write' : 'catalog.write',
  );
  const cloudPath = `${actor.shopId}/${productId}`;
  if (input === undefined) {
    const row = (
      await db.query<{ bytes: Buffer }>(
        'SELECT bytes FROM image_objects WHERE path=$1 AND shop_id=$2',
        [cloudPath, actor.shopId],
      )
    )[0];
    return { dataUrl: row ? `data:image/png;base64,${row.bytes.toString('base64')}` : null };
  }
  const encoded =
    typeof input === 'object' && input !== null ? Reflect.get(input, 'png') : undefined;
  const bytes = typeof encoded === 'string' ? Buffer.from(encoded, 'base64') : null;
  assert(
    input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      Object.keys(input).length === 1 &&
      (Reflect.get(input, 'local') === true ||
        (bytes &&
          bytes.length >= 33 &&
          bytes.length <= 131072 &&
          bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))),
    422,
    'IMAGE_LOCAL_ONLY',
    'Images must be saved on the desktop',
  );
  const path = bytes ? cloudPath : `local/${productId}`;
  await db.transaction(async (tx) => {
    if (bytes)
      await tx.query(
        'INSERT INTO image_objects(path,shop_id,bytes) VALUES($1,$2,$3) ON CONFLICT(path) DO UPDATE SET bytes=excluded.bytes',
        [cloudPath, actor.shopId, bytes],
      );
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
