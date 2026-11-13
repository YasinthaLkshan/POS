import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Connection } from '../../../api/src/database/db';

export interface PgTools {
  pgDump: string;
  pgRestore: string;
}

export function findPgTools(
  env: NodeJS.ProcessEnv = process.env,
  root = 'C:\\Program Files\\PostgreSQL',
): PgTools | null {
  const tools = (bin: string) => ({
    pgDump: join(bin, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump'),
    pgRestore: join(bin, process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore'),
  });
  const usable = (t: PgTools) => existsSync(t.pgDump) && existsSync(t.pgRestore);
  if (env.AGRIPOS_PG_BIN) {
    const configured = tools(env.AGRIPOS_PG_BIN);
    return usable(configured) ? configured : null;
  }
  if (!existsSync(root)) return null;
  const versions = readdirSync(root)
    .filter((name) => /^\d+(\.\d+)?$/.test(name))
    .sort((a, b) => Number(b) - Number(a));
  for (const version of versions) {
    const candidate = tools(join(root, version, 'bin'));
    if (usable(candidate)) return candidate;
  }
  return null;
}

/** Keeps the password out of process arguments, where other local users could read it. */
export function connectionArgs(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('The database URL must include a database name');
  const args = ['--host', url.hostname, '--port', url.port || '5432', '--dbname', database];
  if (url.username) args.push('--username', decodeURIComponent(url.username));
  const env: Record<string, string> = {};
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  const channelBinding = url.searchParams.get('channel_binding');
  if (channelBinding) env.PGCHANNELBINDING = channelBinding;
  return { args, env };
}

export function pruneBackups(directory: string, keep: number) {
  if (!existsSync(directory)) return;
  const files = readdirSync(directory)
    .filter((name) => /^agripos-\d{8}-\d{6}\.dump$/.test(name))
    .sort()
    .reverse();
  for (const name of files.slice(keep)) rmSync(join(directory, name), { force: true });
}

async function value(db: Connection, sql: string) {
  return Number((await db.query<{ v: number | string | null }>(sql))[0]?.v ?? 0);
}

/** Refuses to overwrite a cloud database that is not an older copy of this shop. */
export async function checkBackupTarget(local: Connection, cloud: Connection) {
  const hasShops = await cloud.query<{ t: string | null }>(
    "SELECT to_regclass('public.shops')::text AS t",
  );
  if (!hasShops[0]?.t) return;
  const localShops = new Set(
    (await local.query<{ id: string }>('SELECT id::text AS id FROM shops')).map((r) => r.id),
  );
  const cloudShops = await cloud.query<{ id: string }>('SELECT id::text AS id FROM shops');
  if (cloudShops.some((s) => !localShops.has(s.id)))
    throw new Error(
      'The cloud database contains a different shop. Use an empty Neon database for backups.',
    );
  const hasAudit = await cloud.query<{ t: string | null }>(
    "SELECT to_regclass('public.audit_logs')::text AS t",
  );
  if (!hasAudit[0]?.t) return;
  const latest =
    'SELECT COALESCE(EXTRACT(EPOCH FROM max(created_at)), 0)::float8 AS v FROM audit_logs';
  if ((await value(cloud, latest)) > (await value(local, latest)))
    throw new Error(
      'The cloud copy has newer activity than this computer. A till may still be connected to Neon directly; check every till before backing up.',
    );
}

export type Exec = (file: string, args: string[], env: Record<string, string>) => Promise<void>;

const execFileAsync = promisify(execFile);
export const execTool: Exec = async (file, args, env) => {
  try {
    await execFileAsync(file, args, {
      env: { ...process.env, ...env },
      windowsHide: true,
      timeout: 10 * 60000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(stderr ? stderr.slice(0, 400) : 'PostgreSQL backup tool failed');
  }
};

const stamp = (date: Date) =>
  date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export async function createLocalBackup(options: {
  databaseUrl: string;
  directory: string;
  tools: PgTools;
  keep?: number;
  now?: Date;
  exec?: Exec;
}) {
  mkdirSync(options.directory, { recursive: true });
  const file = join(options.directory, `agripos-${stamp(options.now ?? new Date())}.dump`);
  const source = connectionArgs(options.databaseUrl);
  await (options.exec ?? execTool)(
    options.tools.pgDump,
    ['--format=custom', '--no-owner', '--no-privileges', '--file', file, ...source.args],
    source.env,
  );
  pruneBackups(options.directory, options.keep ?? 48);
  return file;
}

/** Replaces the cloud copy with the backup file in one transaction; a failure leaves it unchanged. */
export async function copyToCloud(options: {
  cloudUrl: string;
  file: string;
  tools: PgTools;
  exec?: Exec;
}) {
  const target = connectionArgs(options.cloudUrl);
  await (options.exec ?? execTool)(
    options.tools.pgRestore,
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--single-transaction',
      '--exit-on-error',
      ...target.args,
      options.file,
    ],
    target.env,
  );
}
