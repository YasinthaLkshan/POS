import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Database } from './db';

const digest = (sql: string) => createHash('sha256').update(sql).digest('hex');
export function migrationChecksums(sql: string) {
  const lf = sql.replace(/\r\n/g, '\n');
  return {
    canonical: digest(lf),
    compatible: new Set([digest(sql), digest(lf), digest(lf.replace(/\n/g, '\r\n'))]),
  };
}

export async function runMigrations(db: Database, directory: string) {
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(4815162342)');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS agripos_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    let applied = 0;
    for (const name of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
      const sql = await readFile(join(directory, name), 'utf8');
      const { canonical: checksum, compatible } = migrationChecksums(sql);
      const previous = (
        await tx.query<{ checksum: string }>(
          'SELECT checksum FROM agripos_migrations WHERE name=$1',
          [name],
        )
      )[0];
      if (previous) {
        if (!compatible.has(previous.checksum))
          throw new Error(`Applied migration was changed: ${name}`);
        continue;
      }
      await tx.query(sql);
      await tx.query('INSERT INTO agripos_migrations(name,checksum) VALUES($1,$2)', [
        name,
        checksum,
      ]);
      applied++;
    }
    return applied;
  });
}
