import pg from 'pg';
pg.types.setTypeParser(20, (value: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('Database integer exceeds supported range');
  return parsed;
});
pg.types.setTypeParser(1082, (value: string) => value);
export type Row = Record<string, unknown>;
export interface Connection {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Database extends Connection {
  transaction<T>(fn: (tx: Connection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgres(url: string): Database {
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 10000 });
  return {
    query: async <T extends Row>(sql: string, params?: unknown[]) =>
      (await pool.query<T>(sql, params)).rows,
    async transaction<T>(fn: (tx: Connection) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: async <R extends Row>(sql: string, params?: unknown[]) =>
            (await client.query<R>(sql, params)).rows,
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
/** Creates the database named in the URL when the server reports it missing. */
export async function ensureDatabase(url: string) {
  const probe = postgres(url);
  try {
    await probe.query('SELECT 1');
    return false;
  } catch (error) {
    if ((error as { code?: string }).code !== '3D000') throw error;
  } finally {
    await probe.close();
  }
  const target = new URL(url),
    name = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name))
    throw new Error('Use a database name containing only letters, numbers and underscores');
  target.pathname = '/postgres';
  const server = postgres(target.toString());
  try {
    await server.query(`CREATE DATABASE "${name}"`);
  } finally {
    await server.close();
  }
  return true;
}
