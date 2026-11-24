import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import type { Connection, Database, Row } from '../src/database/db';
import { LocalDatabase } from '../src/database/sqlite';
export async function testDatabase(engine?: 'postgres'): Promise<Database> {
  if (!engine && process.env.AGRIPOS_SQLITE_TEST === '1') return new LocalDatabase(':memory:');
  const pg = new PGlite();
  for (const name of (await readdir('migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort())
    await pg.exec(await readFile(`migrations/${name}`, 'utf8'));
  const connection = (client: Pick<PGlite, 'query'>): Connection => ({
    query: async <T extends Row>(sql: string, params?: unknown[]) =>
      (await client.query<T>(sql, params)).rows,
  });
  return {
    ...connection(pg),
    transaction: (fn) => pg.transaction((tx) => fn(connection(tx))),
    close: () => pg.close(),
  };
}
