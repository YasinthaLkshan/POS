import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { postgres } from '../apps/api/src/database/db';

const input = z
  .object({
    DATABASE_URL: z.string().min(1),
    ADMIN_USERNAME: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9._-]{2,39}$/),
    ADMIN_PASSWORD_HASH: z.string().regex(/^scrypt\$[A-Za-z0-9_-]{43}\$[A-Za-z0-9_-]{86}$/),
    ADMIN_NAME: z.string().trim().min(1).max(120),
    SHOP_NAME: z.string().trim().min(1).max(120),
    ADMIN_EXISTING_STAFF_ID: z.uuid().optional(),
  })
  .parse(process.env);
const hashed = input.ADMIN_PASSWORD_HASH;
const db = postgres(input.DATABASE_URL);
try {
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(4815162343)');
    if (
      (await tx.query('SELECT id FROM staff WHERE lower(username)=$1', [input.ADMIN_USERNAME]))
        .length
    )
      throw new Error('This administrator username already exists; nothing was changed');
    if (input.ADMIN_EXISTING_STAFF_ID) {
      const rows = await tx.query(
        "UPDATE staff SET username=$1,password_hash=$2 WHERE id=$3 AND role='administrator' AND active AND username IS NULL RETURNING id",
        [input.ADMIN_USERNAME, hashed, input.ADMIN_EXISTING_STAFF_ID],
      );
      if (!rows.length)
        throw new Error('Existing active administrator was not found or already has a username');
      console.info('Existing administrator linked; historical IDs and business records retained.');
    } else {
      const shopId = randomUUID();
      await tx.query('INSERT INTO shops(id,name) VALUES($1,$2)', [shopId, input.SHOP_NAME]);
      await tx.query(
        "INSERT INTO staff(id,shop_id,name,role,username,password_hash) VALUES($1,$2,$3,'administrator',$4,$5)",
        [randomUUID(), shopId, input.ADMIN_NAME, input.ADMIN_USERNAME, hashed],
      );
      console.info(`Administrator provisioned for shop ${shopId}. No stock or sales were created.`);
    }
  });
} finally {
  await db.close();
}
console.info('Keep the administrator password private and maintain a secure recovery plan.');
