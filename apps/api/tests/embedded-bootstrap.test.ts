import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Connection, Database, Row } from '../src/database/db';
import { runMigrations } from '../src/database/migrate';
import { ensureAdministrator } from '../src/services/bootstrap';
import { login } from '../src/services/accounts';

it('migrates an empty database and creates a working first administrator once', async () => {
  const pg = new PGlite();
  const connection = (client: Pick<PGlite, 'query' | 'exec'>): Connection => ({
    query: async <T extends Row>(sql: string, params?: unknown[]) =>
      params?.length || !sql.includes(';')
        ? (await client.query<T>(sql, params)).rows
        : (((await client.exec(sql)).at(-1)?.rows ?? []) as T[]),
  });
  const db: Database = {
    ...connection(pg),
    transaction: (fn) => pg.transaction((tx) => fn(connection(tx))),
    close: () => pg.close(),
  };
  try {
    expect(await runMigrations(db, 'supabase/migrations')).toBeGreaterThan(0);
    await expect(ensureAdministrator(db, {})).rejects.toThrow('initial administrator password');
    expect(
      await ensureAdministrator(db, { password: 'new-secret-123', shopName: 'Test Shop' }),
    ).toEqual({ created: true });
    expect(
      (await login(db, { username: 'admin', password: 'new-secret-123' })).user.shopId,
    ).toBeTruthy();
    expect(await runMigrations(db, 'supabase/migrations')).toBe(0);
    expect(await ensureAdministrator(db, {})).toEqual({ created: false });
  } finally {
    await db.close();
  }
});
