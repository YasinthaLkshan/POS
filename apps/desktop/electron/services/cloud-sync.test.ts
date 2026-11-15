import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDatabase } from '../../../api/tests/database';
import { LocalDatabase } from '../../../api/src/database/sqlite';
import { CloudSync } from './cloud-sync';
import { hashPassword } from '../../../api/src/services/passwords';
import { login } from '../../../api/src/services/accounts';
import { passwordAuthentication } from '../../../api/src/middleware/auth';
it('keeps normal login and role offline across restart, uploads once, downloads changes and preserves conflicts', async () => {
  const cloud = await testDatabase('postgres');
  const dir = mkdtempSync(join(tmpdir(), 'agripos-sync-'));
  let local = new LocalDatabase(join(dir, 'shop.sqlite'));
  const shop = randomUUID(),
    staff = randomUUID();
  try {
    await cloud.query('INSERT INTO shops(id,name) VALUES($1,$2)', [shop, 'Test shop']);
    await cloud.query(
      "INSERT INTO staff(id,shop_id,name,role,username,password_hash) VALUES($1,$2,'Cashier','cashier','cashier',$3)",
      [staff, shop, await hashPassword('same-password-123')],
    );
    let sync = new CloudSync(local, cloud);
    await sync.sync();
    expect(sync.initialized).toBe(true);
    expect(sync.lastError).toBeNull();
    await sync.setOffline(true);
    const originalTransaction = cloud.transaction;
    cloud.transaction = async () => {
      throw new Error('Offline mode must not contact cloud');
    };
    await sync.sync();
    expect(sync.lastError).toBeNull();
    expect(sync.offline).toBe(true);
    cloud.transaction = originalTransaction;
    await local.close();
    local = new LocalDatabase(join(dir, 'shop.sqlite'));
    sync = new CloudSync(local, cloud);
    expect(sync.offline).toBe(true);
    await sync.setOffline(false);
    const signed = await login(local, { username: 'cashier', password: 'same-password-123' });
    expect((await passwordAuthentication(local)(signed.token)).role).toBe('cashier');
    await expect(
      login(local, { username: 'cashier', password: 'wrong-password-123' }),
    ).rejects.toThrow('incorrect');
    await local.query('INSERT INTO categories(shop_id,name,kind) VALUES($1,$2,$3)', [
      shop,
      'Offline product category',
      'other',
    ]);
    expect(sync.pending).toBe(true);
    const image = Buffer.alloc(40, 1);
    await local.query('INSERT INTO image_objects(path,shop_id,bytes) VALUES($1,$2,$3)', [
      `${shop}/logo`,
      shop,
      image,
    ]);
    await local.close();
    local = new LocalDatabase(join(dir, 'shop.sqlite'));
    sync = new CloudSync(local, cloud);
    expect(sync.pending).toBe(true);
    expect((await passwordAuthentication(local)(signed.token)).role).toBe('cashier');
    let loseAcknowledgement = true;
    sync = new CloudSync(local, {
      ...cloud,
      transaction: async (fn) => {
        const result = await cloud.transaction(fn);
        if (loseAcknowledgement) {
          loseAcknowledgement = false;
          throw new Error('Lost acknowledgement after commit');
        }
        return result;
      },
    });
    await sync.sync();
    expect(sync.lastError).not.toBeNull();
    expect(sync.pending).toBe(true);
    await sync.sync();
    expect(sync.lastError).toBeNull();
    expect(sync.pending).toBe(false);
    expect(await cloud.query('SELECT name FROM categories')).toEqual([
      { name: 'Offline product category' },
    ]);
    await sync.sync();
    expect((await cloud.query('SELECT * FROM categories')).length).toBe(1);
    expect(
      Buffer.from(
        (await cloud.query<{ bytes: Buffer }>('SELECT bytes FROM image_objects'))[0]!.bytes,
      ),
    ).toEqual(image);
    await cloud.query("UPDATE staff SET role='manager' WHERE id=$1", [staff]);
    await sync.sync();
    expect((await passwordAuthentication(local)(signed.token)).role).toBe('manager');
    await cloud.query('UPDATE staff SET password_hash=$2 WHERE id=$1', [
      staff,
      await hashPassword('new-password-123'),
    ]);
    await sync.sync();
    await expect(passwordAuthentication(local)(signed.token)).rejects.toThrow('expired');
    await expect(
      login(local, { username: 'cashier', password: 'same-password-123' }),
    ).rejects.toThrow('incorrect');
    expect(
      (await login(local, { username: 'cashier', password: 'new-password-123' })).user.id,
    ).toBe(staff);
    await local.query("UPDATE shops SET name='Local edit' WHERE id=$1", [shop]);
    await cloud.query("UPDATE shops SET name='Cloud edit' WHERE id=$1", [shop]);
    await sync.sync();
    expect(sync.lastError).toContain('Changes exist');
    expect((await local.query('SELECT name FROM shops'))[0]?.name).toBe('Local edit');
    expect((await cloud.query('SELECT name FROM shops'))[0]?.name).toBe('Cloud edit');
  } finally {
    await local.close();
    await cloud.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

it('keeps local writes available during cloud delays and uploads them on the next retry', async () => {
  const cloud = await testDatabase('postgres');
  const dir = mkdtempSync(join(tmpdir(), 'agripos-live-sync-'));
  const local = new LocalDatabase(join(dir, 'shop.sqlite'));
  const sync = new CloudSync(local, cloud);
  const shop = randomUUID();
  try {
    await cloud.query('INSERT INTO shops(id,name) VALUES($1,$2)', [shop, 'Shop']);
    await sync.sync();
    const transaction = cloud.transaction;
    cloud.transaction = async () => {
      throw Object.assign(new Error('No network'), { code: 'ENOTFOUND' });
    };
    await local.query("UPDATE shops SET name='Offline edit' WHERE id=$1", [shop]);
    await sync.sync();
    expect(sync.pending).toBe(true);
    expect(sync.lastError).toContain('Cannot reach Neon');
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const entered = new Promise<void>((r) => {
      started = r;
    });
    cloud.transaction = async (fn) => {
      started();
      await gate;
      return transaction(fn);
    };
    const attempt = sync.sync();
    await entered;
    try {
      await Promise.race([
        local.query("UPDATE shops SET name='New sale period edit' WHERE id=$1", [shop]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Cloud blocked local work')), 1000),
        ),
      ]);
    } finally {
      release();
      await attempt;
    }
    expect((await local.query('SELECT name FROM shops'))[0]?.name).toBe('New sale period edit');
    expect(sync.pending).toBe(true);
    cloud.transaction = transaction;
    await sync.sync();
    expect(sync.pending).toBe(false);
    expect(sync.lastError).toBeNull();
    expect((await cloud.query('SELECT name FROM shops'))[0]?.name).toBe('New sale period edit');
    await cloud.query("UPDATE shops SET name='Remote change' WHERE id=$1", [shop]);
    const secondGate = new Promise<void>((r) => {
      release = r;
    });
    const secondEntered = new Promise<void>((r) => {
      started = r;
    });
    cloud.transaction = async (fn) => {
      started();
      await secondGate;
      return transaction(fn);
    };
    const download = sync.sync();
    await secondEntered;
    try {
      await local.query("UPDATE shops SET name='New local work' WHERE id=$1", [shop]);
    } finally {
      release();
      await download;
    }
    expect(sync.lastError).toContain('Changes exist');
    expect((await local.query('SELECT name FROM shops'))[0]?.name).toBe('New local work');
    expect((await cloud.query('SELECT name FROM shops'))[0]?.name).toBe('Remote change');
  } finally {
    await local.close();
    await cloud.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
