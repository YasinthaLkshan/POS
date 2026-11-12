import 'dotenv/config';
import { postgres } from '../apps/api/src/database/db';
const required = ['DATABASE_URL', 'OFFLINE_SIGNING_KEY'];
for (const key of required) {
  const value = process.env[key];
  if (!value || /replace/i.test(value))
    throw new Error(`Fill ${key} in .env before checking setup`);
}
if (process.env.OFFLINE_SIGNING_KEY!.length < 32)
  throw new Error('Generate an OFFLINE_SIGNING_KEY of at least 32 random characters');
const db = postgres(process.env.DATABASE_URL!);
try {
  await db.query('SELECT username,password_hash FROM staff LIMIT 1');
  await db.query('SELECT token_hash FROM auth_sessions LIMIT 1');
  console.info('PASS Neon PostgreSQL connection and username/password schema');
  const rows = await db.query(
    "SELECT id FROM staff WHERE role='administrator' AND active AND username IS NOT NULL AND password_hash IS NOT NULL LIMIT 1",
  );
  console.info(rows.length ? 'PASS Active administrator exists' : 'NEXT Run npm run setup:admin');
} finally {
  await db.close();
}
console.info('Next: sign in as administrator, add a local image, and verify a staging sale.');
