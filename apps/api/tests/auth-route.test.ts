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

it("limits daily sales staff to checkout and today's receipts", async () => {
  const app = createApp(db, passwordAuthentication(db));
  const staff = randomUUID(),
    today = randomUUID(),
    older = randomUUID();
  await db.query(
    "INSERT INTO staff(id,shop_id,name,role,username,password_hash) VALUES($1,$2,'Staff','daily_sales','till',$3)",
    [staff, shopId, await hashPassword('test-till-password')],
  );
  for (const [sale, time] of [
    [today, new Date().toISOString()],
    [older, '2020-01-01T00:00:00Z'],
  ]) {
    await db.query(
      'INSERT INTO sales(id,shop_id,terminal_id,cashier_id,subtotal,discount,tax,total,cost,credit,created_at,invoice_number) VALUES($1,$2,$3,$4,0,0,0,0,0,0,$5,$6)',
      [sale, shopId, randomUUID(), staffId, time, sale],
    );
  }
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'till', password: 'test-till-password' })
    .expect(200);
  const auth = 'Bearer ' + login.body.data.token;
  const list = await request(app).get('/api/v1/sales').set('Authorization', auth).expect(200);
  expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([today]);
  await request(app)
    .get('/api/v1/sales/' + today + '/receipt')
    .set('Authorization', auth)
    .expect(200);
  for (const path of [older, older + '/receipt'])
    await request(app)
      .get('/api/v1/sales/' + path)
      .set('Authorization', auth)
      .expect(404);
  for (const path of [
    'reports/business',
    'dashboard/summary',
    'inventory',
    'staff',
    'notifications',
    'sales/park',
  ])
    await request(app)
      .get('/api/v1/' + path)
      .set('Authorization', auth)
      .expect(403);
  await request(app).post('/api/v1/products').set('Authorization', auth).send({}).expect(403);
});
