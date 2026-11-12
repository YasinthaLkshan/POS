import 'dotenv/config';
import { resolve } from 'node:path';
import { postgres } from '../apps/api/src/database/db';
import { runMigrations } from '../apps/api/src/database/migrate';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const db = postgres(process.env.DATABASE_URL);
try {
  const count = await runMigrations(db, resolve('supabase/migrations'));
  console.info(`Applied ${count} migration(s)`);
} finally {
  await db.close();
}
