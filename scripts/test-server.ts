/** Isolated E2E authentication fixture. NEVER imported by the deployable API. */
import express from 'express';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '../apps/api/tests/database';
import { createApp } from '../apps/api/src/app';
import type { Actor } from '@agripos/shared';
import { hashPassword } from '../apps/api/src/services/passwords';
import { passwordAuthentication } from '../apps/api/src/middleware/auth';
import { LocalDatabase } from '../apps/api/src/database/sqlite';
import { CloudSync } from '../apps/desktop/electron/services/cloud-sync';
const db = await testDatabase();
process.env.OFFLINE_SIGNING_KEY = 'isolated-e2e-offline-signing-key-never-production';
const actor: Actor = {
  id: randomUUID(),
  shopId: randomUUID(),
  name: 'Test Administrator',
  role: 'administrator',
};
await db.query(
  "INSERT INTO shops(id,name,address,phone) VALUES($1,'TEST — AgriPOS Shop','Test address','011 000 0000')",
  [actor.shopId],
);
await db.query(
  'INSERT INTO staff(id,shop_id,name,role,username,password_hash) VALUES($1,$2,$3,$4,$5,$6)',
  [
    actor.id,
    actor.shopId,
    actor.name,
    actor.role,
    'admin',
    await hashPassword('Local-test-only-2026'),
  ],
);
const server = express();
server.use(express.json());
let disconnected = false;
const local = new LocalDatabase(':memory:');
const sync = new CloudSync(local, {
  ...db,
  transaction: (fn) => {
    if (disconnected) return Promise.reject(new Error('Test cloud disconnected'));
    return db.transaction(fn);
  },
});
await sync.sync();
server.post('/__fixture/connection', (req, res) => {
  disconnected = req.body.offline === true;
  res.json({ offline: disconnected });
});
server.post('/__fixture/sync', async (_req, res) => {
  await sync.sync();
  res.json({ pending: sync.pending, error: sync.lastError });
});
server.use(createApp(local, passwordAuthentication(local)));
const listener = server.listen(4199, '127.0.0.1');
const shutdown = () => listener.close(() => void db.close().then(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
