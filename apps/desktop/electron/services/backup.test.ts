import { afterAll, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  checkBackupTarget,
  connectionArgs,
  copyToCloud,
  createLocalBackup,
  findPgTools,
  pruneBackups,
} from './backup';
import { testDatabase } from '../../../api/tests/database';
const root = mkdtempSync(join(tmpdir(), 'agripos-backup-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const exe = process.platform === 'win32' ? '.exe' : '';
it('passes database passwords through the environment, never process arguments', () => {
  const { args, env } = connectionArgs(
    'postgresql://agri%40pos:p%40ss%20word@shop-pc:5433/agripos?sslmode=require&channel_binding=require',
  );
  expect(args).toEqual([
    '--host',
    'shop-pc',
    '--port',
    '5433',
    '--dbname',
    'agripos',
    '--username',
    'agri@pos',
  ]);
  expect(args.join(' ')).not.toContain('p@ss word');
  expect(env).toEqual({
    PGPASSWORD: 'p@ss word',
    PGSSLMODE: 'require',
    PGCHANNELBINDING: 'require',
  });
  expect(() => connectionArgs('postgresql://user@localhost:5432/')).toThrow('database name');
});
it('finds the newest installed PostgreSQL tools', () => {
  const install = join(root, 'PostgreSQL');
  for (const version of ['9.6', '16', '18', 'pgAdmin 4']) {
    const bin = join(install, version, 'bin');
    mkdirSync(bin, { recursive: true });
    if (version !== '9.6') {
      writeFileSync(join(bin, `pg_dump${exe}`), '');
      writeFileSync(join(bin, `pg_restore${exe}`), '');
    }
  }
  expect(findPgTools({}, install)?.pgDump).toBe(join(install, '18', 'bin', `pg_dump${exe}`));
  expect(findPgTools({ AGRIPOS_PG_BIN: join(install, '16', 'bin') }, install)?.pgRestore).toBe(
    join(install, '16', 'bin', `pg_restore${exe}`),
  );
  expect(findPgTools({ AGRIPOS_PG_BIN: join(install, '9.6', 'bin') }, install)).toBeNull();
  expect(findPgTools({}, join(root, 'missing'))).toBeNull();
});
it('keeps only the newest backup files and leaves other files alone', () => {
  const dir = join(root, 'prune');
  mkdirSync(dir);
  for (const day of ['01', '02', '03', '04'])
    writeFileSync(join(dir, `agripos-202611${day}-120000.dump`), '');
  writeFileSync(join(dir, 'notes.txt'), '');
  pruneBackups(dir, 2);
  expect(readdirSync(dir).sort()).toEqual([
    'agripos-20261103-120000.dump',
    'agripos-20261104-120000.dump',
    'notes.txt',
  ]);
});
it('dumps the shop database and restores the cloud copy in one transaction', async () => {
  const exec = vi.fn().mockResolvedValue(undefined);
  const tools = { pgDump: 'pg_dump', pgRestore: 'pg_restore' };
  const file = await createLocalBackup({
    databaseUrl: 'postgresql://agripos:secret@localhost:5432/agripos',
    directory: join(root, 'dumps'),
    tools,
    exec,
    now: new Date('2026-11-13T17:45:09Z'),
  });
  expect(file).toBe(join(root, 'dumps', 'agripos-20261113-174509.dump'));
  expect(exec).toHaveBeenCalledWith(
    'pg_dump',
    expect.arrayContaining(['--format=custom', '--file', file, '--dbname', 'agripos']),
    { PGPASSWORD: 'secret' },
  );
  await copyToCloud({
    cloudUrl: 'postgresql://neon:cloud@ep-x.neon.tech/backup?sslmode=require',
    file,
    tools,
    exec,
  });
  const [tool, args, env] = exec.mock.calls[1]!;
  expect(tool).toBe('pg_restore');
  expect(args).toEqual(
    expect.arrayContaining(['--clean', '--single-transaction', '--exit-on-error', file]),
  );
  expect(env).toEqual({ PGPASSWORD: 'cloud', PGSSLMODE: 'require' });
});
it('refuses to overwrite a cloud database holding another shop or newer activity', async () => {
  const local = await testDatabase(),
    cloud = await testDatabase(),
    empty = await testDatabase();
  try {
    const shop = randomUUID(),
      staff = randomUUID();
    for (const db of [local, cloud]) {
      await db.query("INSERT INTO shops(id,name) VALUES($1,'Main shop')", [shop]);
      await db.query(
        "INSERT INTO staff(id,shop_id,name,role) VALUES($1,$2,'Admin','administrator')",
        [staff, shop],
      );
    }
    const activity = (db: typeof local, at: string) =>
      db.query(
        "INSERT INTO audit_logs(shop_id,actor_id,action,entity_id,created_at) VALUES($1,$2,'test',$1,$3)",
        [shop, staff, at],
      );
    await activity(local, '2026-11-13T10:00:00Z');
    await activity(cloud, '2026-11-13T09:00:00Z');
    await expect(checkBackupTarget(local, empty)).resolves.toBeUndefined();
    await expect(checkBackupTarget(local, cloud)).resolves.toBeUndefined();
    await activity(cloud, '2026-11-13T11:00:00Z');
    await expect(checkBackupTarget(local, cloud)).rejects.toThrow('newer activity');
    await cloud.query("INSERT INTO shops(id,name) VALUES($1,'Someone else')", [randomUUID()]);
    await expect(checkBackupTarget(local, cloud)).rejects.toThrow('different shop');
  } finally {
    await Promise.all([local.close(), cloud.close(), empty.close()]);
  }
});
