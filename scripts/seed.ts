import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { postgres } from '../apps/api/src/database/db';
import { z } from 'zod';
import { hashPassword } from '../apps/api/src/services/passwords';
if (process.env.NODE_ENV === 'production')
  throw new Error('Development seed is prohibited in production');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const username = z
    .string()
    .regex(/^[a-z][a-z0-9._-]{2,39}$/)
    .parse(process.env.SEED_ADMIN_USERNAME),
  password = z.string().min(12).parse(process.env.SEED_ADMIN_PASSWORD),
  userId = randomUUID(),
  shopId = randomUUID();
const hashed = await hashPassword(password);
const db = postgres(process.env.DATABASE_URL);
try {
  await db.transaction(async (tx) => {
    if ((await tx.query('SELECT id FROM staff WHERE username=$1', [username])).length)
      throw new Error('This user is already provisioned');
    await tx.query("INSERT INTO shops(id,name) VALUES($1,'DEMO — AgriPOS Training Shop')", [
      shopId,
    ]);
    await tx.query(
      "INSERT INTO staff(id,shop_id,name,role,username,password_hash) VALUES($1,$2,'Training Administrator','administrator',$3,$4)",
      [userId, shopId, username, hashed],
    );
    for (const [name, kind] of [
      ['Fertilizers', 'fertilizer'],
      ['Seeds', 'seed'],
      ['Plants and Seedlings', 'plant'],
      ['Agricultural Equipment', 'equipment'],
      ['Gardening Accessories', 'other'],
      ['Other Products', 'other'],
    ])
      await tx.query('INSERT INTO categories(shop_id,name,kind) VALUES($1,$2,$3)', [
        shopId,
        name,
        kind,
      ]);
  });
  console.info(`Created development shop ${shopId}. No sales or stock were fabricated.`);
} finally {
  await db.close();
}
