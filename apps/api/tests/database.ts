import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import type { Connection, Database, Row } from '../src/database/db';
export async function testDatabase(): Promise<Database> {
  const pg = new PGlite();
  for (const name of (await readdir('supabase/migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort())
    await pg.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
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
