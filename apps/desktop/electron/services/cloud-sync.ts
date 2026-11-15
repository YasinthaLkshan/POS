import { binding, LocalDatabase, sqliteTables } from '../../../api/src/database/sqlite';
import type { Database, Connection, Row } from '../../../api/src/database/db';

type Snapshot = Record<string, Row[]>;
export function syncFailureMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const saved = ' Your work is saved on this computer. Automatic sync retries every 30 seconds.';
  if (['28P01', '28000'].includes(code))
    return (
      'Neon rejected the saved database credentials. Update the cloud connection in Settings.' +
      saved
    );
  if (
    [
      'ENOTFOUND',
      'EAI_AGAIN',
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      '08006',
      '57P01',
    ].includes(code)
  )
    return (
      'Cannot reach Neon. Keep working offline; sync resumes when the connection returns.' + saved
    );
  if (/^[0-9A-Z]{5}$/.test(code))
    return `Cloud sync needs attention (database error ${code}).` + saved;
  return 'Cloud sync is pending because the last attempt failed.' + saved;
}
const tables = sqliteTables.filter((t) => t.name !== 'auth_sessions');
const stable = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
const keyColumns = (table: (typeof tables)[number]) =>
  table.constraints
    .find((c) => c.kind === 'p')!
    .sql.match(/\((.*)\)/)![1]!
    .split(',')
    .map((c) => c.trim());
const rowKey = (table: (typeof tables)[number], row: Row) =>
  stable(keyColumns(table).map((c) => row[c]));
function normalize(table: (typeof tables)[number], row: Row): Row {
  return Object.fromEntries(
    table.columns.map((c) => {
      let v = row[c.name];
      if (v !== null && v !== undefined) {
        if (c.type === 'bool') v = Boolean(v);
        else if (c.type === 'jsonb' && typeof v === 'string') v = JSON.parse(v);
        else if (c.type === 'bytea') v = Buffer.from(v as Uint8Array).toString('base64');
        else if (c.type === 'timestamptz') v = new Date(v as string).toISOString();
        else if (c.type === 'date')
          v = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
        else if (['int4', 'int8'].includes(c.type)) v = Number(v);
      }
      // Failed-login counters belong to this installation, not cloud synchronization.
      if (table.name === 'staff' && c.name === 'login_failures') v = 0;
      if (table.name === 'staff' && c.name === 'locked_until') v = null;
      return [c.name, v ?? null];
    }),
  );
}
function ordered() {
  const result: typeof tables = [],
    pending = [...tables];
  while (pending.length) {
    const index = pending.findIndex((t) =>
      t.constraints
        .filter((c) => c.kind === 'f')
        .every((c) => {
          const parent = c.sql.match(/REFERENCES (\w+)/)?.[1];
          return parent === t.name || !pending.some((p) => p.name === parent);
        }),
    );
    if (index < 0) throw new Error('Cyclic synchronization schema');
    result.push(pending.splice(index, 1)[0]!);
  }
  return result;
}
export class CloudSync {
  running = false;
  lastError: string | null = null;
  lastSyncedAt: string | null = null;
  constructor(
    readonly local: LocalDatabase,
    private cloud: Database,
  ) {
    this.lastSyncedAt = this.get('lastSyncedAt');
  }
  private get(key: string) {
    return (
      (
        this.local.raw.prepare('SELECT value FROM _local_state WHERE key=?').get(key) as
          { value: string } | undefined
      )?.value ?? null
    );
  }
  private set(key: string, value: string) {
    this.local.raw
      .prepare(
        'INSERT INTO _local_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
  get initialized() {
    return this.get('baseline') !== null;
  }
  private localSnapshot(): Snapshot {
    return Object.fromEntries(
      tables.map((t) => [
        t.name,
        (this.local.raw.prepare(`SELECT * FROM "${t.name}"`).all() as Row[])
          .map((r) => normalize(t, r))
          .sort((a, b) => rowKey(t, a).localeCompare(rowKey(t, b))),
      ]),
    );
  }
  private async cloudSnapshot(tx: Connection): Promise<Snapshot> {
    const result: Snapshot = {};
    for (const t of tables)
      result[t.name] = (await tx.query(`SELECT * FROM "${t.name}"`))
        .map((r) => normalize(t, r))
        .sort((a, b) => rowKey(t, a).localeCompare(rowKey(t, b)));
    return result;
  }
  get pending() {
    const baseline = this.get('baseline');
    return baseline !== null && stable(this.localSnapshot()) !== baseline;
  }
  private import(snapshot: Snapshot) {
    const db = this.local.raw;
    this.local.importing = true;
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      const staff = new Map(
        (
          db
            .prepare('SELECT id,password_hash,login_failures,locked_until FROM staff')
            .all() as Row[]
        ).map((r) => [r.id, r]),
      );
      for (const t of tables) {
        db.prepare(`DELETE FROM "${t.name}"`).run();
        const insert = db.prepare(
          `INSERT INTO "${t.name}" (${t.columns.map((c) => `"${c.name}"`).join(',')}) VALUES (${t.columns.map(() => '?').join(',')})`,
        );
        for (const row of snapshot[t.name]!) {
          let values = row;
          if (t.name === 'staff') {
            const previous = staff.get(row.id);
            if (previous?.password_hash !== row.password_hash)
              db.prepare('DELETE FROM auth_sessions WHERE staff_id=?').run(row.id);
            else if (previous)
              values = {
                ...row,
                login_failures: previous.login_failures,
                locked_until: previous.locked_until,
              };
          }
          insert.run(
            ...t.columns.map((c) =>
              binding(
                c.type === 'bytea' && values[c.name] !== null
                  ? Buffer.from(values[c.name] as string, 'base64')
                  : values[c.name],
              ),
            ),
          );
        }
      }
      const violations = db.pragma('foreign_key_check') as unknown[];
      if (violations.length) throw new Error('Cloud data failed its relationship checks');
      this.set('baseline', stable(snapshot));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      db.pragma('foreign_keys = ON');
      this.local.importing = false;
    }
  }
  private async push(tx: Connection, before: Snapshot, after: Snapshot) {
    for (const t of ordered().reverse()) {
      const current = new Set(after[t.name]!.map((r) => rowKey(t, r)));
      for (const row of before[t.name]!)
        if (!current.has(rowKey(t, row))) {
          const keys = keyColumns(t);
          await tx.query(
            `DELETE FROM "${t.name}" WHERE ${keys.map((k, i) => `"${k}"=$${i + 1}`).join(' AND ')}`,
            keys.map((k) => row[k]),
          );
        }
    }
    for (const t of ordered()) {
      const previous = new Map(before[t.name]!.map((r) => [rowKey(t, r), r]));
      for (const row of after[t.name]!) {
        const old = previous.get(rowKey(t, row));
        if (old && stable(old) === stable(row)) continue;
        const cols = t.columns.filter(
          (c) => !(t.name === 'staff' && ['login_failures', 'locked_until'].includes(c.name)),
        );
        const values = cols.map((c) =>
          c.type === 'bytea' && row[c.name] !== null
            ? Buffer.from(row[c.name] as string, 'base64')
            : c.type === 'jsonb'
              ? JSON.stringify(row[c.name])
              : row[c.name],
        );
        if (!old)
          await tx.query(
            `INSERT INTO "${t.name}" (${cols.map((c) => `"${c.name}"`).join(',')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(',')})`,
            values,
          );
        else {
          const keys = keyColumns(t);
          await tx.query(
            `UPDATE "${t.name}" SET ${cols.map((c, i) => `"${c.name}"=$${i + 1}`).join(',')} WHERE ${keys.map((k, i) => `"${k}"=$${values.length + i + 1}`).join(' AND ')}`,
            [...values, ...keys.map((k) => row[k])],
          );
        }
      }
    }
  }
  async sync() {
    if (this.offline) return;
    if (this.running) return;
    this.running = true;
    try {
      const captured = await this.local.exclusive(async () =>
        this.offline ? null : { baseline: this.get('baseline'), local: this.localSnapshot() },
      );
      if (!captured) return;
      const { baseline, local } = captured;
      const remote = await this.cloud.transaction(async (tx) => {
        await tx.query('SELECT pg_advisory_xact_lock(4815162344)');
        await tx.query(
          `LOCK TABLE ${tables.map((t) => `"${t.name}"`).join(',')} IN SHARE ROW EXCLUSIVE MODE`,
        );
        const remote = await this.cloudSnapshot(tx);
        if (!baseline || stable(local) === baseline) return remote;
        if (stable(remote) === stable(local)) return remote; // Retry after an acknowledgement was lost.
        if (stable(remote) !== baseline)
          throw new Error(
            'Changes exist on both computers. Your local work is saved. Synchronization is paused to prevent overwriting shop data.',
          );
        await this.push(tx, JSON.parse(baseline) as Snapshot, local);
        return local;
      });
      await this.local.exclusive(async () => {
        // Cloud requests must not block checkout. Never overwrite work saved while awaiting Neon.
        if (stable(remote) !== stable(local) && stable(this.localSnapshot()) !== stable(local))
          throw new Error(
            'Changes exist on both computers. Your local work is saved. Synchronization is paused to prevent overwriting shop data.',
          );
        if (stable(remote) !== stable(local)) this.import(remote);
        else this.set('baseline', stable(remote));
        this.lastSyncedAt = new Date().toISOString();
        this.set('lastSyncedAt', this.lastSyncedAt);
        this.lastError = null;
      });
    } catch (error) {
      this.lastError =
        error instanceof Error && error.message.startsWith('Changes exist')
          ? error.message
          : syncFailureMessage(error);
      if (!this.initialized)
        throw new Error(
          'Connect to the internet once to download your shop before using it offline.',
        );
    } finally {
      this.running = false;
    }
  }
  async close() {
    await this.cloud.close();
  }
  get offline() {
    return this.get('workOffline') === 'true';
  }
  async setOffline(enabled: boolean) {
    if (!this.initialized)
      throw new Error('Connect once to download your shop before working offline.');
    await this.local.exclusive(async () => {
      this.set('workOffline', String(enabled));
    });
    if (!enabled) await this.sync();
  }
}
