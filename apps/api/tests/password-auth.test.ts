import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './database';
import type { Database } from '../src/database/db';
import { hashPassword } from '../src/services/passwords';
import { login, logout, changePassword } from '../src/services/accounts';
import { passwordAuthentication } from '../src/middleware/auth';
let db: Database;
const staffId = randomUUID();
const shopId = randomUUID();
beforeAll(async () => {
  db = await testDatabase();
  await db.query("INSERT INTO shops(id,name) VALUES($1,'Auth test')", [shopId]);
  await db.query(
    "INSERT INTO staff(id,shop_id,name,role,username,password_hash) VALUES($1,$2,'Admin','administrator','admin',$3)",
    [staffId, shopId, await hashPassword('first-password-123')],
  );
});
afterAll(async () => db.close());
it('signs in by username with an opaque session, then revokes it on logout', async () => {
  const session = await login(db, { username: 'ADMIN', password: 'first-password-123' });
  expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(session.user).toEqual({ id: staffId, shopId });
  expect(await passwordAuthentication(db)(session.token)).toMatchObject({
    id: staffId,
    role: 'administrator',
  });
  await logout(db, session.token);
  await expect(passwordAuthentication(db)(session.token)).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
});
it('rejects wrong passwords and revokes sessions when a password changes', async () => {
  await expect(
    login(db, { username: 'admin', password: 'wrong-password-123' }),
  ).rejects.toMatchObject({ code: 'LOGIN_FAILED' });
  const session = await login(db, { username: 'admin', password: 'first-password-123' });
  await changePassword(db, staffId, {
    currentPassword: 'first-password-123',
    newPassword: 'second-password-123',
  });
  await expect(passwordAuthentication(db)(session.token)).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  await expect(
    login(db, { username: 'admin', password: 'first-password-123' }),
  ).rejects.toMatchObject({ code: 'LOGIN_FAILED' });
  expect((await login(db, { username: 'admin', password: 'second-password-123' })).user.id).toBe(
    staffId,
  );
});
