import 'dotenv/config';
import { z } from 'zod';
import { postgres } from '../apps/api/src/database/db';
const input = z
  .object({
    DATABASE_URL: z.string().min(1),
    ADMIN_USERNAME: z.string().regex(/^[a-z][a-z0-9._-]{2,39}$/),
    ADMIN_PASSWORD_HASH: z.string().regex(/^scrypt\$[A-Za-z0-9_-]{43}\$[A-Za-z0-9_-]{86}$/),
  })
  .parse(process.env);
const db = postgres(input.DATABASE_URL);
try {
  await db.transaction(async (tx) => {
    const rows = await tx.query<{ id: string }>(
      "UPDATE staff SET password_hash=$2,login_failures=0,locked_until=NULL WHERE username=$1 AND role='administrator' AND active RETURNING id",
      [input.ADMIN_USERNAME, input.ADMIN_PASSWORD_HASH],
    );
    if (rows.length !== 1) throw new Error('Active administrator username not found');
    await tx.query('DELETE FROM auth_sessions WHERE staff_id=$1', [rows[0]!.id]);
  });
  console.info('Administrator password hash updated; all prior sessions revoked.');
} finally {
  await db.close();
}
