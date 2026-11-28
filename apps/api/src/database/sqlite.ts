import Sqlite from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Connection, Database, Row } from './db';
import schema from './sqlite-schema.json';

/** PostgreSQL spellings used by the shared business services, mapped to SQLite. */
export function sqliteSql(input: string) {
  return input
    .replace(/CROSS JOIN LATERAL jsonb_array_elements\(([^)]+)\)/gi, 'CROSS JOIN json_each($1)')
    .replace(
      /\((now\(\)|[\w.$]+)(?:::timestamptz)? AT TIME ZONE 'Asia\/Colombo'\)::date/gi,
      "date($1,'+330 minutes')",
    )
    .replace(/date\(now\(\),'\+330 minutes'\)/g, 'shop_today()')
    .replace(/shop_today\(\)\s*([+-])\s*([\w.]+)/g, "date(shop_today(),'$1' || $2 || ' days')")
    .replace(/\(([\w.]+)-shop_today\(\)\)::int/g, '(julianday($1)-julianday(shop_today()))')
    .replace(/(\$\d+|'[0-9-]+')::date\s*([+-])\s*(\d+)/g, "date($1,'$2$3 days')")
    .replace(
      /now\(\)\s*\+\s*interval '15 minutes'/gi,
      "strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes')",
    )
    .replace(/date\(([^)]*)\)\s*\+\s*([\w.]+)/gi, "date($1,'+' || $2 || ' days')")
    .replace(/\(([\w.]+)-date\(([^)]*)\)\)::int/gi, '(julianday($1)-julianday(date($2)))')
    .replace(/([\w.]+)::numeric/gi, '(1.0*$1)')
    .replace(
      /::(?:uuid|text|bigint|integer|int|numeric|boolean|jsonb|timestamptz|timestamp|date)(?:\[\])?/gi,
      '',
    )
    .replace(/=\s*ANY\s*\(ARRAY\[([^\]]*)\]\)/gi, 'IN ($1)')
    .replace(/=\s*ANY\s*\((\$\d+)\)/gi, ' IN (SELECT value FROM json_each($1))')
    .replace(/\bILIKE\b|~~/gi, 'LIKE')
    .replace(/\bFOR UPDATE(?: OF [\w, ]+)?/gi, '')
    .replace(/\bpublic\./g, '')
    .replace(/\bUSING btree\b/gi, '')
    .replace(/TRIM\(BOTH FROM /gi, 'trim(')
    .replace(/substring\((\w+) FROM (\d+)\)/gi, 'substr($1,$2)')
    .replace(/([\w.]+) ~ ('[^']*')/g, 'regexp($2,$1)')
    .replace(/\bGREATEST\(/gi, 'max(')
    .replace(/\bLEAST\(/gi, 'min(');
}

export const sqliteTables = schema;
const bools = new Set(
  schema.flatMap((t) => t.columns.filter((c) => c.type === 'bool').map((c) => c.name)),
);
const jsons = new Set(
  schema.flatMap((t) => t.columns.filter((c) => c.type === 'jsonb').map((c) => c.name)),
);
export function binding(value: unknown): string | number | Buffer | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number;
}
export class LocalDatabase implements Database {
  readonly raw: Sqlite.Database;
  importing = false;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(path: string) {
    this.raw = new Sqlite(path);
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('synchronous = FULL');
    this.raw.function('gen_random_uuid', () => randomUUID());
    this.raw.function('sync_importing', () => Number(this.importing));
    this.raw.function('now', () => new Date().toISOString());
    this.raw.function('shop_today', () =>
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }),
    );
    this.raw.function('octet_length', (v) => Buffer.byteLength(v as string | Buffer));
    this.raw.function('split_part', (v, s, n) => String(v).split(String(s))[Number(n) - 1] ?? '');
    this.raw.function('regexp', (pattern, value) =>
      Number(new RegExp(String(pattern)).test(String(value))),
    );
    this.raw.function('to_regclass', (name) =>
      schema.some((t) => t.name === String(name).replace(/^public\./, '')) ? String(name) : null,
    );
    for (const table of schema) {
      const columns = table.columns.map(
        (c) =>
          `"${c.name}" ${['int8', 'int4', 'bool'].includes(c.type) ? 'INTEGER' : c.type === 'bytea' ? 'BLOB' : 'TEXT'}${c.nullable ? '' : ' NOT NULL'}${c.default === null ? '' : ` DEFAULT (${sqliteSql(c.default)})`}`,
      );
      const constraints = table.constraints.map((c) => sqliteSql(c.sql));
      const definition = [...columns, ...constraints].join(',');
      if (table.name === 'staff') {
        const prior = this.raw
          .prepare("SELECT sql FROM sqlite_schema WHERE name='staff' AND type='table'")
          .get() as { sql: string } | undefined;
        if (prior && !prior.sql.includes("'daily_sales'")) {
          this.raw.pragma('foreign_keys = OFF');
          try {
            this.raw.transaction(() => {
              const names = table.columns.map((c) => `"${c.name}"`).join(',');
              this.raw.exec(`CREATE TABLE staff_upgrade (${definition});
                INSERT INTO staff_upgrade (${names}) SELECT ${names} FROM staff;
                DROP TABLE staff;
                ALTER TABLE staff_upgrade RENAME TO staff`);
              for (const index of table.indexes) this.raw.exec(sqliteSql(index.sql));
              if ((this.raw.pragma('foreign_key_check') as unknown[]).length)
                throw new Error('Staff schema upgrade failed its relationship checks');
            })();
          } finally {
            this.raw.pragma('foreign_keys = ON');
          }
        }
      }
      this.raw.exec(`CREATE TABLE IF NOT EXISTS "${table.name}" (${definition})`);
      for (const index of table.indexes)
        this.raw.exec(
          sqliteSql(index.sql).replace(/CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS '),
        );
    }
    this.raw
      .exec(`CREATE TABLE IF NOT EXISTS _local_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE VIEW IF NOT EXISTS financial_events AS SELECT shop_id,id,created_at,total,tax,cost,1 transactions,'sale' type FROM sales UNION ALL SELECT shop_id,id,created_at,-total_amount,-tax,-cost,0,'return' FROM returns;
      CREATE VIEW IF NOT EXISTS installment_balances AS SELECT i.*,COALESCE(p.paid,0) paid,COALESCE(r.reduced,0) reduced,i.amount-COALESCE(p.paid,0)-COALESCE(r.reduced,0) remaining FROM credit_installments i LEFT JOIN (SELECT installment_id,SUM(amount) paid FROM installment_allocations GROUP BY installment_id) p ON p.installment_id=i.id LEFT JOIN (SELECT installment_id,SUM(amount) reduced FROM installment_reductions GROUP BY installment_id) r ON r.installment_id=i.id;`);
    this.raw.pragma('foreign_keys = ON');
    for (const name of [
      'inventory_movements',
      'customer_ledger',
      'audit_logs',
      'cash_movements',
      'supplier_ledger',
      'returns',
      'return_lines',
      'return_allocations',
      'repayment_allocations',
      'supplier_returns',
      'stock_conversions',
      'credit_installments',
      'installment_allocations',
      'installment_reductions',
    ]) {
      for (const action of ['UPDATE', 'DELETE'])
        this.raw.exec(
          `CREATE TRIGGER IF NOT EXISTS immutable_${name}_${action} BEFORE ${action} ON ${name} WHEN sync_importing()=0 BEGIN SELECT RAISE(ABORT,'Accounting history is immutable'); END`,
        );
    }
  }
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private execute<T extends Row>(sql: string, params: unknown[] = []): T[] {
    if (/^SELECT pg_advisory_xact_lock/.test(sql)) return [];
    const values: (string | number | Buffer | null)[] = [];
    const translated = sqliteSql(sql).replace(/\$(\d+)/g, (_, n) => {
      values.push(binding(params[Number(n) - 1]));
      return '?';
    });
    let statement: Sqlite.Statement;
    try {
      statement = this.raw.prepare(translated);
    } catch (error) {
      if (process.env.AGRIPOS_SQLITE_TEST === '1') console.error('SQLite SQL:', translated);
      throw error;
    }
    if (!statement.reader) {
      statement.run(...values);
      return [];
    }
    return (statement.all(...values) as Row[]).map(
      (row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            v === null
              ? null
              : bools.has(k)
                ? !!v
                : jsons.has(k) && typeof v === 'string'
                  ? JSON.parse(v)
                  : v,
          ]),
        ) as T,
    );
  }
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.exclusive(async () => this.execute<T>(sql, params));
  }
  transaction<T>(fn: (tx: Connection) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn({
          query: async <R extends Row>(sql: string, params?: unknown[]) =>
            this.execute<R>(sql, params),
        });
        this.raw.exec('COMMIT');
        return result;
      } catch (error) {
        this.raw.exec('ROLLBACK');
        throw error;
      }
    });
  }
  async close() {
    await this.tail;
    this.raw.close();
  }
}
