import { randomUUID } from 'node:crypto';
import type { Database } from '../database/db';
import { hashPassword } from './passwords';

export async function ensureAdministrator(
  db: Database,
  input: { password?: string; shopName?: string; existingStaffId?: string },
) {
  const existing = await db.query(
    "SELECT id FROM staff WHERE role='administrator' AND active AND username IS NOT NULL AND password_hash IS NOT NULL LIMIT 1",
  );
  if (existing.length) return { created: false };
  if (!input.password || input.password.length < 12 || input.password.length > 256)
    throw new Error('Enter an initial administrator password of 12 to 256 characters');
  const hashed = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(4815162343)');
    const prior = await tx.query(
      "SELECT id FROM staff WHERE role='administrator' AND active AND username IS NOT NULL AND password_hash IS NOT NULL LIMIT 1",
    );
    if (prior.length) return { created: false };
    if (input.existingStaffId) {
      const linked = await tx.query(
        "UPDATE staff SET username='admin',password_hash=$2 WHERE id=$1 AND role='administrator' AND active AND username IS NULL RETURNING id",
        [input.existingStaffId, hashed],
      );
      if (!linked.length)
        throw new Error('Existing administrator staff ID was not found or already has a username');
      return { created: true };
    }
    const shops = await tx.query('SELECT id FROM shops LIMIT 1');
    if (shops.length)
      throw new Error(
        'This database already has a shop. Enter its administrator staff ID to link it.',
      );
    const shopId = randomUUID();
    await tx.query('INSERT INTO shops(id,name) VALUES($1,$2)', [
      shopId,
      input.shopName?.trim() || 'My Agricultural Shop',
    ]);
    await tx.query(
      "INSERT INTO staff(id,shop_id,name,role,username,password_hash) VALUES($1,$2,'admin','administrator','admin',$3)",
      [randomUUID(), shopId, hashed],
    );
    return { created: true };
  });
}
