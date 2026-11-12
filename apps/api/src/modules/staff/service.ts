import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { roleNames, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { requirePermission, audit } from '../../services/transactions';
import { hashPassword } from '../../services/passwords';
import { assert } from '../../utils/errors';

const schema = z
  .object({
    name: z.string().trim().min(1).max(120),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9._-]{2,39}$/),
    password: z.string().min(12).max(256),
    role: z.enum(roleNames),
  })
  .strict();

export async function inviteStaff(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'staff.manage');
  const p = schema.parse(input);
  const hashed = await hashPassword(p.password);
  return db.transaction(async (tx) => {
    const existing = await tx.query('SELECT id FROM staff WHERE lower(username)=$1', [p.username]);
    assert(!existing.length, 409, 'STAFF_EXISTS', 'Username already exists');
    const staffId = randomUUID();
    await tx.query(
      'INSERT INTO staff(id,shop_id,name,role,username,password_hash) VALUES($1,$2,$3,$4,$5,$6)',
      [staffId, actor.shopId, p.name, p.role, p.username, hashed],
    );
    await audit(tx, actor, 'staff.invite', staffId, { username: p.username, role: p.role });
    return { id: staffId, invited: true };
  });
}
