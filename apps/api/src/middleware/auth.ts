import { type Actor, roleNames } from '@agripos/shared';
import type { Database } from '../database/db';
import { assert } from '../utils/errors';
import { hashSession } from '../services/accounts';
export type Authenticate = (token: string) => Promise<Actor>;
export function passwordAuthentication(db: Database): Authenticate {
  return async (token) => {
    const row = (
      await db.query<{ id: string; shop_id: string; name: string; role: Actor['role'] }>(
        'SELECT s.id,s.shop_id,s.name,s.role FROM auth_sessions a JOIN staff s ON s.id=a.staff_id WHERE a.token_hash=$1 AND a.expires_at>now() AND s.active=true',
        [hashSession(token)],
      )
    )[0];
    assert(
      row && roleNames.includes(row.role),
      401,
      'UNAUTHORIZED',
      'Session expired or revoked. Please sign in again',
    );
    return { id: row.id, shopId: row.shop_id, name: row.name, role: row.role };
  };
}
