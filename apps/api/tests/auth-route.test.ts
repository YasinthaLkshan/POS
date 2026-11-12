import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { testDatabase } from './database';
import type { Database } from '../src/database/db';
import { hashPassword } from '../src/services/passwords';
import { passwordAuthentication } from '../src/middleware/auth';
import { createApp } from '../src/app';
let db: Database;
const shopId = randomUUID();
const staffId = randomUUID();
beforeAll(async () => {
  db = await testDatabase();
  await db.query("INSERT INTO shops(id,name) VALUES($1,'Test shop')", [shopId]);
  await db.query(
    "INSERT INTO staff(id,shop_id,name,role,username,password_hash) VALUES($1,$2,'Admin','administrator','admin',$3)",
    [staffId, shopId, await hashPassword('test-password-123')],
  );
});
afterAll(async () => db.close());
it('logs in publicly then protects business routes with an opaque session', async () => {
  const app = createApp(db, passwordAuthentication(db));
  expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password: 'test-password-123' });
  expect(response.status).toBe(200);
  const token = response.body.data.token as string;
  expect(
    (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).body.data
      .id,
  ).toBe(staffId);
  expect(
    (await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`)).status,
  ).toBe(200);
  expect(
    (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).status,
  ).toBe(401);
});
