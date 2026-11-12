import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../database/db';
import { AppError, assert } from '../utils/errors';
import { hashPassword, verifyPassword } from './passwords';

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9._-]{2,39}$/);
const password = z.string().min(12).max(256);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const sessionDays = 7;
const dummyPasswordHash = hashPassword('invalid-account-placeholder');

export async function login(db: Database, input: unknown) {
  const p = z.object({ username, password }).strict().parse(input);
  const row = (
    await db.query<{
      id: string;
      shop_id: string;
      password_hash: string | null;
      active: boolean;
      login_failures: number;
      locked_until: Date | string | null;
    }>(
      'SELECT id,shop_id,password_hash,active,login_failures,locked_until FROM staff WHERE lower(username)=$1',
      [p.username],
    )
  )[0];
  const valid = await verifyPassword(p.password, row?.password_hash ?? (await dummyPasswordHash));
  const locked = row?.locked_until && new Date(row.locked_until).getTime() > Date.now();
  if (!row || !row.active || locked || !valid) {
    if (row && row.active && !locked) {
      await db.query(
        "UPDATE staff SET login_failures=login_failures+1,locked_until=CASE WHEN login_failures+1>=5 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$1",
        [row.id],
      );
    }
    throw new AppError(401, 'LOGIN_FAILED', 'Username or password is incorrect');
  }
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionDays * 86400000);
  await db.transaction(async (tx) => {
    await tx.query('UPDATE staff SET login_failures=0,locked_until=NULL WHERE id=$1', [row.id]);
    await tx.query('INSERT INTO auth_sessions(token_hash,staff_id,expires_at) VALUES($1,$2,$3)', [
      tokenHash(token),
      row.id,
      expiresAt,
    ]);
  });
  return { token, expiresAt: expiresAt.toISOString(), user: { id: row.id, shopId: row.shop_id } };
}

export async function logout(db: Database, token: string) {
  await db.query('DELETE FROM auth_sessions WHERE token_hash=$1', [tokenHash(token)]);
}

export async function changePassword(db: Database, staffId: string, input: unknown) {
  const p = z.object({ currentPassword: password, newPassword: password }).strict().parse(input);
  const row = (
    await db.query<{ password_hash: string | null }>(
      'SELECT password_hash FROM staff WHERE id=$1',
      [staffId],
    )
  )[0];
  assert(
    row?.password_hash && (await verifyPassword(p.currentPassword, row.password_hash)),
    401,
    'INVALID_PASSWORD',
    'Current password is incorrect',
  );
  const hashed = await hashPassword(p.newPassword);
  await db.transaction(async (tx) => {
    await tx.query(
      'UPDATE staff SET password_hash=$2,login_failures=0,locked_until=NULL WHERE id=$1',
      [staffId, hashed],
    );
    await tx.query('DELETE FROM auth_sessions WHERE staff_id=$1', [staffId]);
  });
  return { changed: true };
}

export function hashSession(token: string) {
  return tokenHash(token);
}
