import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  addDays,
  addMonths,
  businessDate,
  defaultSchedule,
  paymentLabel,
  reportKinds,
  type Actor,
} from '@agripos/shared';
import type { Database } from '../src/database/db';
import { testDatabase } from './database';
import { createApp } from '../src/app';

let db: Database, app: ReturnType<typeof createApp>;
const terminalId = randomUUID();
const owner: Actor = {
  id: randomUUID(),
  shopId: randomUUID(),
  name: 'Owner',
  role: 'administrator',
};
const cashier: Actor = { ...owner, id: randomUUID(), name: 'Cashier', role: 'cashier' };
const as = (token: string) => ({
  post: (path: string, body: object) =>
    request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  get: (path: string) => request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`),
});
const admin = as('admin');
const till = as('cashier');
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await testDatabase();
  await db.query("INSERT INTO shops(id,name) VALUES($1,'Green Valley Agro')", [owner.shopId]);
  for (const a of [owner, cashier])
    await db.query('INSERT INTO staff(id,shop_id,name,role) VALUES($1,$2,$3,$4)', [
      a.id,
      a.shopId,
      a.name,
      a.role,
    ]);
  app = createApp(db, async (token) => (token === 'admin' ? owner : cashier));
});
afterAll(async () => {
  await db?.close();
});

it('TEST 1: groups drivers under factories and finds them by factory search', async () => {
  const factory = await admin.post('/factories', { name: 'Ceylon Tea Factory', phone: '0812' });
  expect(factory.status, factory.text).toBe(201);
  ids.factory = factory.body.data.id;
  ids.otherFactory = (await admin.post('/factories', { name: 'Kandy Mills' })).body.data.id;
  expect((await admin.post('/factories', { name: ' ceylon tea factory ' })).status).toBe(409);
  for (const [name, lorry] of [
    ['Nimal Perera', 'LB-1234'],
    ['Sunil Silva', 'LC-5678'],
  ] as const) {
    const driver = await till.post('/drivers', {
      name,
      factoryId: ids.factory,
      lorryNumber: lorry,
    });
    expect(driver.status, driver.text).toBe(201);
    ids[name] = driver.body.data.id;
  }
  ids.otherDriver = (
    await admin.post('/drivers', { name: 'Kamal Fernando', factoryId: ids.otherFactory })
  ).body.data.id;
  const duplicate = await admin.post('/drivers', { name: 'nimal perera', factoryId: ids.factory });
  expect(duplicate.body.error.code).toBe('DUPLICATE_DRIVER');
  const codes = (await admin.get('/drivers')).body.data.map(
    (d: { driver_code: string }) => d.driver_code,
  );
  expect(codes.sort()).toEqual(['DRV-0001', 'DRV-0002', 'DRV-0003']);
  const byFactory = (await admin.get(`/drivers?factoryId=${ids.factory}`)).body.data;
  expect(byFactory.map((d: { name: string }) => d.name)).toEqual(['Nimal Perera', 'Sunil Silva']);
  expect((await admin.get('/drivers?search=LC-56')).body.data[0].name).toBe('Sunil Silva');
  expect((await admin.get('/drivers?search=kandy')).body.data[0].name).toBe('Kamal Fernando');
  const details = (await admin.get(`/factories/${ids.factory}`)).body.data;
  expect(details.totals.drivers).toBe(2);
  expect((await admin.get('/factories?search=ceylon')).body.data[0].drivers).toBe(2);
  expect((await admin.get('/customers')).body.data).toHaveLength(0);
});

const stockOf = async (productId: string | undefined) =>
  (await admin.get(`/products/${productId!}`)).body.data.stock as number;
const receive = (productId: string | undefined, quantity: number) =>
  admin.post('/inventory/receipts', { operationId: randomUUID(), productId: productId!, quantity });
const sale = (body: object, client = till) =>
  client.post('/sales', { operationId: randomUUID(), terminalId, payments: [], ...body });

it('TEST 2: keeps independent prices and stock for loose, 25 kg and 50 kg variants', async () => {
  const fertilizer = (await admin.post('/categories', { name: 'Fertilizer', kind: 'fertilizer' }))
    .body.data.id;
  const tools = (await admin.post('/categories', { name: 'Tools', kind: 'equipment' })).body.data
    .id;
  const family = await admin.post('/product-families', {
    name: 'Fertilizer A',
    categoryId: fertilizer,
    variants: [
      { label: 'Loose', sku: 'FA-L', unit: 'kg', wholeUnits: false, sellingPrice: 12000 },
      {
        label: '25 kg bag',
        sku: 'FA-25',
        unit: 'bag',
        wholeUnits: true,
        sellingPrice: 280000,
        driverDiscount: 1000,
      },
      {
        label: '50 kg bag',
        sku: 'FA-50',
        unit: 'bag',
        wholeUnits: true,
        sellingPrice: 540000,
        driverDiscount: 2000,
      },
    ],
  });
  expect(family.status, family.text).toBe(201);
  const [loose, bag25, bag50] = family.body.data.variants;
  Object.assign(ids, { loose: loose.id, bag25: bag25.id, bag50: bag50.id });
  ids.sprayer = (
    await admin.post('/products', {
      name: 'Knapsack sprayer',
      sku: 'SPR-1',
      categoryId: tools,
      sellingPrice: 1000000,
      purchasePrice: 700000,
    })
  ).body.data.id;
  for (const [productId, quantity] of [
    [ids.loose, 100000],
    [ids.bag25, 20000],
    [ids.bag50, 10000],
    [ids.sprayer, 10000],
  ] as const)
    expect((await receive(productId, quantity)).status).toBe(201);
  const listed = (await admin.get('/products?search=Fertilizer%20A')).body.data.items;
  expect(
    listed.map(
      (p: {
        variant_label: string;
        selling_price: number;
        stock: number;
        driver_discount: number;
      }) => [p.variant_label, p.selling_price, p.stock, p.driver_discount],
    ),
  ).toEqual([
    ['25 kg bag', 280000, 20000, 1000],
    ['50 kg bag', 540000, 10000, 2000],
    ['Loose', 12000, 100000, 0],
  ]);
  expect((await receive(ids.bag25, 1500)).body.error.code).toBe('WHOLE_UNITS');
});

it('TEST 3 and 4: applies driver discounts per bag and quantity', async () => {
  const driver = ids['Nimal Perera']!;
  const three = await sale({
    customerId: driver,
    lines: [{ productId: ids.bag25, quantity: 3000 }],
    payments: [{ method: 'cash', amount: 837000 }],
  });
  expect(three.status, three.text).toBe(201);
  expect(three.body.data).toMatchObject({ subtotal: 840000, driverDiscount: 3000, total: 837000 });
  const two = await sale({
    customerId: driver,
    lines: [{ productId: ids.bag50, quantity: 2000 }],
    payments: [{ method: 'cash', amount: 1076000 }],
  });
  expect(two.body.data).toMatchObject({ driverDiscount: 4000, total: 1076000 });
  const both = await sale({
    customerId: driver,
    lines: [
      { productId: ids.bag25, quantity: 3000 },
      { productId: ids.bag50, quantity: 2000 },
    ],
    payments: [{ method: 'cash', amount: 1913000 }],
  });
  expect(both.body.data).toMatchObject({ driverDiscount: 7000, total: 1913000 });
  const lines = (await admin.get(`/sales/${both.body.data.id}`)).body.data.lines;
  expect(lines.map((l: { auto_discount: number }) => l.auto_discount).sort()).toEqual([3000, 4000]);
  const walkIn = await sale({
    lines: [{ productId: ids.bag25, quantity: 1000 }],
    payments: [{ method: 'cash', amount: 280000 }],
  });
  expect(walkIn.body.data.driverDiscount).toBe(0);
  const loose = await sale({
    lines: [{ productId: ids.loose, quantity: 1250 }],
    payments: [{ method: 'cash', amount: 15000 }],
  });
  expect(loose.status, loose.text).toBe(201);
  expect(await stockOf(ids.loose)).toBe(98750);
});

it('TEST 5: applies a bill discount to a normal sale only with approval', async () => {
  const body = {
    lines: [{ productId: ids.sprayer, quantity: 1000 }],
    orderDiscount: 50000,
    payments: [{ method: 'cash', amount: 950000 }],
  };
  expect((await sale(body)).status).toBe(403);
  const approved = await sale(body, admin);
  expect(approved.status, approved.text).toBe(201);
  expect(approved.body.data).toMatchObject({
    subtotal: 1000000,
    billDiscount: 50000,
    total: 950000,
  });
  expect(approved.body.data.invoiceNumber).toMatch(/^AGR-\d{6}$/);
  expect((await sale({ ...body, orderDiscount: 1000001 }, admin)).status).toBe(422);
});

it('TEST 6: splits a driver sale into cash now and credit for the rest', async () => {
  const before = await stockOf(ids.sprayer);
  const result = await sale({
    customerId: ids['Sunil Silva'],
    lines: [{ productId: ids.sprayer, quantity: 2000 }],
    payments: [{ method: 'cash', amount: 800000 }],
    cashTendered: 1000000,
  });
  expect(result.status, result.text).toBe(201);
  expect(result.body.data).toMatchObject({ total: 2000000, credit: 1200000, change: 200000 });
  expect(result.body.data.schedule).toHaveLength(2);
  expect(await stockOf(ids.sprayer)).toBe(before - 2000);
  const profile = (await admin.get(`/drivers/${ids['Sunil Silva']}`)).body.data;
  expect(profile.customer.outstanding).toBe(1200000);
  expect(profile.totals).toMatchObject({
    purchases: 2000000,
    paid_at_sale: 800000,
    credit_issued: 1200000,
  });
  expect(profile.invoices[0].payment_type).toBe('mixed');
  const payments = await db.query<{ method: string; amount: number }>(
    'SELECT method,amount FROM payments WHERE sale_id=$1',
    [result.body.data.id],
  );
  expect(payments).toEqual([{ method: 'cash', amount: 800000 }]);
});

it('TEST 13 and 14: changes stock only for committed sales', async () => {
  const before = await stockOf(ids.bag50);
  const ledger = async () =>
    (await db.query<{ n: number }>('SELECT COUNT(*)::int n FROM customer_ledger'))[0]!.n;
  const entries = await ledger();
  const tooMuch = await sale({
    customerId: ids['Nimal Perera'],
    lines: [{ productId: ids.bag50, quantity: 999000 }],
  });
  expect(tooMuch.body.error.code).toBe('INSUFFICIENT_STOCK');
  const partBag = await sale({
    customerId: ids['Nimal Perera'],
    lines: [{ productId: ids.bag50, quantity: 1500 }],
  });
  expect(partBag.body.error.code).toBe('WHOLE_UNITS');
  const badSchedule = await sale({
    customerId: ids['Nimal Perera'],
    lines: [{ productId: ids.bag50, quantity: 1000 }],
    schedule: [{ dueDate: '2099-01-01', amount: 1 }],
  });
  expect(badSchedule.body.error.code).toBe('SCHEDULE');
  expect(await stockOf(ids.bag50)).toBe(before);
  expect(await ledger()).toBe(entries);
});

it('TEST 15: a repeated or concurrent submission creates one invoice', async () => {
  const body = {
    operationId: randomUUID(),
    terminalId,
    lines: [{ productId: ids.loose, quantity: 1000 }],
    payments: [{ method: 'cash', amount: 12000 }],
  };
  const results = await Promise.all([till.post('/sales', body), till.post('/sales', body)]);
  expect(results.map((r) => r.status)).toEqual([201, 201]);
  expect(results[0]!.body.data.invoiceNumber).toBe(results[1]!.body.data.invoiceNumber);
  expect((await db.query('SELECT id FROM sales WHERE id=$1', [body.operationId])).length).toBe(1);
  expect(
    (
      await till.post('/sales', {
        ...body,
        payments: [{ method: 'cash', amount: 12000 }],
        cashTendered: 20000,
      })
    ).status,
  ).toBe(409);
});

const today = businessDate();
const pay = (customerId: string, amount: number, extra: object = {}) =>
  till.post(`/customers/${customerId}/payments`, {
    operationId: randomUUID(),
    payment: { method: 'cash', amount },
    ...extra,
  });
const installmentsOf = async (customerId: string) =>
  (await admin.get(`/customers/${customerId}/installments`)).body.data as {
    id: string;
    sale_id: string;
    seq: number;
    due_date: string;
    amount: number;
    paid: number;
    remaining: number;
    status: string;
  }[];

it('TEST 7 and 8: schedules each driver credit separately and totals dues by month', async () => {
  const driver = ids['Nimal Perera']!;
  expect((await receive(ids.loose, 100000)).status).toBe(201);
  const first = await sale({
    customerId: driver,
    lines: [{ productId: ids.sprayer, quantity: 2000 }],
  });
  expect(first.status, first.text).toBe(201);
  expect(first.body.data.schedule).toEqual(defaultSchedule(2000000, today, 2));
  expect(first.body.data.schedule.map((s: { amount: number }) => s.amount)).toEqual([
    1000000, 1000000,
  ]);
  ids.firstCredit = first.body.data.id;
  const second = await sale({
    customerId: driver,
    lines: [{ productId: ids.loose, quantity: 100000 }],
  });
  expect(second.body.data.credit).toBe(1200000);
  ids.secondCredit = second.body.data.id;
  const profile = (await admin.get(`/drivers/${driver}`)).body.data;
  expect(
    profile.monthly.map((m: { month: string; amount: number }) => [m.month, m.amount]),
  ).toEqual([
    [addMonths(today, 1).slice(0, 7), 1600000],
    [addMonths(today, 2).slice(0, 7), 1600000],
  ]);
  expect(profile.installments).toHaveLength(4);
  expect(new Set(profile.installments.map((i: { sale_id: string }) => i.sale_id)).size).toBe(2);
  expect(profile.customer.outstanding).toBe(3200000);
});

it('TEST 9 and 10: partial payments reduce one installment until it is paid', async () => {
  const driver = ids['Nimal Perera']!;
  const preview = await till.post(`/customers/${driver}/payments/preview`, { amount: 400000 });
  expect(preview.body.data.allocations).toEqual([
    expect.objectContaining({ amount: 400000, remainingBefore: 1000000, remainingAfter: 600000 }),
  ]);
  const firstInstallment = (await installmentsOf(driver)).find(
    (i) => i.sale_id === ids.firstCredit && i.seq === 1,
  )!;
  expect((await pay(driver, 400000)).status).toBe(201);
  let current = (await installmentsOf(driver)).find((i) => i.id === firstInstallment.id)!;
  expect(current).toMatchObject({ amount: 1000000, paid: 400000, remaining: 600000 });
  expect(paymentLabel(current.amount, current.remaining)).toBe('Partially paid');
  expect(current.status).not.toBe('paid');
  const second = await pay(driver, 600000, { notes: 'Balance of first installment' });
  expect(second.status).toBe(201);
  current = (await installmentsOf(driver)).find((i) => i.id === firstInstallment.id)!;
  expect(current).toMatchObject({ remaining: 0, status: 'paid' });
  const actionable = (await till.get(`/credit/due?search=Nimal`)).body.data.rows;
  expect(actionable.some((r: { id: string }) => r.id === firstInstallment.id)).toBe(false);
  const paid = (await till.get(`/credit/due?status=paid&search=Nimal`)).body.data.rows;
  expect(paid.map((r: { id: string }) => r.id)).toContain(firstInstallment.id);
  const receipt = (await till.get(`/repayments/${second.body.data.id}/receipt`)).body.data;
  expect(receipt).toMatchObject({ amount: 600000, method: 'cash', customer_name: 'Nimal Perera' });
  expect(receipt.allocations[0]).toMatchObject({ amount: 600000, seq: 1 });
  expect(receipt.balance_after).toBe(2200000);
});

it('allows explicit installment selection and refuses over-allocation', async () => {
  const driver = ids['Nimal Perera']!;
  const target = (await installmentsOf(driver)).find(
    (i) => i.sale_id === ids.secondCredit && i.seq === 2,
  )!;
  const explicit = await pay(driver, 100000, {
    allocations: [{ installmentId: target.id, amount: 100000 }],
  });
  expect(explicit.status, explicit.text).toBe(201);
  expect((await installmentsOf(driver)).find((i) => i.id === target.id)!.remaining).toBe(500000);
  const over = await pay(driver, 600000, {
    allocations: [{ installmentId: target.id, amount: 600000 }],
  });
  expect(over.body.error.code).toBe('ALLOCATION');
  expect((await pay(driver, 99999999)).body.error.code).toBe('OVERPAYMENT');
  const repeat = { operationId: randomUUID(), payment: { method: 'cash', amount: 1000 } };
  const both = await Promise.all([
    till.post(`/customers/${driver}/payments`, repeat),
    till.post(`/customers/${driver}/payments`, repeat),
  ]);
  expect(both[0]!.body.data.id).toBe(both[1]!.body.data.id);
  expect(
    (await db.query('SELECT id FROM customer_ledger WHERE id=$1', [repeat.operationId])).length,
  ).toBe(1);
});

it('TEST 11: gives credit to a normal customer without a permanent profile', async () => {
  const due = addDays(today, 3);
  const result = await sale({
    lines: [{ productId: ids.loose, quantity: 5000 }],
    payments: [{ method: 'cash', amount: 20000 }],
    creditCustomer: { name: 'Saman Kumara', phone: '0771112222', notes: 'Paddy field' },
    dueDate: due,
  });
  expect(result.status, result.text).toBe(201);
  expect(result.body.data.credit).toBe(40000);
  const sameName = await sale({
    lines: [{ productId: ids.loose, quantity: 1000 }],
    creditCustomer: { name: 'Saman Kumara' },
  });
  expect(sameName.body.data.customerId).not.toBe(result.body.data.customerId);
  expect(sameName.body.data.schedule).toEqual([{ dueDate: addMonths(today, 1), amount: 12000 }]);
  const list = (await till.get('/credit/due?type=normal&search=Saman')).body.data;
  expect(
    list.rows.map((r: { due_date: string; status: string; customer_kind: string }) => [
      r.due_date,
      r.status,
      r.customer_kind,
    ]),
  ).toEqual([
    [due, 'due_soon', 'walk_in'],
    [addMonths(today, 1), 'upcoming', 'walk_in'],
  ]);
  expect((await till.get('/credit/due?type=driver&search=Saman')).body.data.rows).toHaveLength(0);
  expect((await admin.get('/customers?kind=walk_in&search=Saman')).body.data).toHaveLength(2);
  expect((await admin.get('/customers')).body.data).toHaveLength(0);
  ids.saman = result.body.data.customerId;
});

it('TEST 12: lists overdue credit before due today and upcoming credit', async () => {
  const late = await sale({
    lines: [{ productId: ids.loose, quantity: 1000 }],
    creditCustomer: { name: 'Overdue Ovitigala' },
    dueDate: today,
  });
  const saleId = randomUUID();
  await db.query(
    "INSERT INTO sales(id,shop_id,terminal_id,customer_id,cashier_id,subtotal,discount,tax,total,cost,credit,due_date,invoice_number,customer_name) VALUES($1,$2,$3,$4,$5,5000,0,0,5000,0,5000,$6,'AGR-LEGACY-1','Saman Kumara')",
    [saleId, owner.shopId, terminalId, ids.saman, owner.id, addDays(today, -5)],
  );
  await db.query(
    "INSERT INTO customer_ledger(shop_id,customer_id,sale_id,amount,type,actor_id) VALUES($1,$2,$3,5000,'credit_sale',$4)",
    [owner.shopId, ids.saman, saleId, owner.id],
  );
  await db.query(
    'INSERT INTO credit_installments(shop_id,sale_id,seq,due_date,amount) VALUES($1,$2,1,$3,5000)',
    [owner.shopId, saleId, addDays(today, -5)],
  );
  const due = (await till.get('/credit/due')).body.data;
  const order = due.rows.map((r: { status: string }) => r.status);
  expect(order[0]).toBe('overdue');
  expect(order.indexOf('due_today')).toBeLessThan(order.indexOf('upcoming'));
  expect(order.lastIndexOf('overdue')).toBeLessThan(order.indexOf('due_today'));
  expect(due.rows[0]).toMatchObject({ days: -5, remaining: 5000, invoice_number: 'AGR-LEGACY-1' });
  expect(due.summary.overdue).toEqual({ count: 1, remaining: 5000 });
  expect(late.body.data.schedule[0].dueDate).toBe(today);
});

it('TEST 19: a return reduces the latest installment and restores stock', async () => {
  const driver = ids['Nimal Perera']!;
  const before = await installmentsOf(driver);
  const balance = (await admin.get(`/drivers/${driver}`)).body.data.customer.outstanding;
  const stock = await stockOf(ids.loose);
  const line = (await admin.get(`/sales/${ids.secondCredit}`)).body.data.lines[0];
  const returned = await admin.post(`/sales/${ids.secondCredit}/returns`, {
    operationId: randomUUID(),
    reason: 'Half returned unopened',
    restock: true,
    lines: [{ lineId: line.id, quantity: 25000 }],
  });
  expect(returned.status, returned.text).toBe(201);
  expect(returned.body.data).toMatchObject({
    total: 300000,
    creditAmount: 300000,
    refundAmount: 0,
  });
  expect(await stockOf(ids.loose)).toBe(stock + 25000);
  const after = await installmentsOf(driver);
  const remaining = (rows: typeof after, seq: number) =>
    rows.find((i) => i.sale_id === ids.secondCredit && i.seq === seq)!.remaining;
  expect(remaining(after, 2)).toBe(remaining(before, 2) - 300000);
  expect(remaining(after, 1)).toBe(remaining(before, 1));
  expect((await admin.get(`/drivers/${driver}`)).body.data.customer.outstanding).toBe(
    balance - 300000,
  );
});

it('TEST 16: dashboard, daily summary, credit list and reports agree with the ledger', async () => {
  const { summary } = (await admin.get(`/reports/business?from=${today}&to=${today}`)).body.data;
  const sql = async (query: string) =>
    Number((await db.query<{ v: number }>(query, [owner.shopId]))[0]!.v);
  expect(summary.sales_total).toBe(
    await sql('SELECT COALESCE(SUM(total),0)::bigint v FROM sales WHERE shop_id=$1'),
  );
  expect(summary.credit_created).toBe(
    await sql('SELECT COALESCE(SUM(credit),0)::bigint v FROM sales WHERE shop_id=$1'),
  );
  expect(summary.outstanding).toBe(
    await sql('SELECT SUM(amount)::bigint v FROM customer_ledger WHERE shop_id=$1'),
  );
  expect(summary.repayments_total).toBe(
    await sql(
      "SELECT -SUM(amount)::bigint v FROM customer_ledger WHERE shop_id=$1 AND type='repayment'",
    ),
  );
  expect(summary.net_cash_collected).toBe(
    summary.cash_from_sales + summary.repayments_cash - summary.cash_refunds,
  );
  expect(summary.net_sales).toBe(summary.sales_total - summary.returns_total);
  expect(summary.gross_sales - summary.discounts).toBe(summary.sales_total);
  expect(summary.driver_discounts).toBe(3000 + 4000 + 7000);
  const due = (await admin.get('/credit/due?status=all&limit=1000')).body.data;
  const listed = Object.values(due.summary as Record<string, { remaining: number }>).reduce(
    (sum, s) => sum + s.remaining,
    0,
  );
  expect(listed).toBe(summary.outstanding);
  const outstanding = (await admin.get(`/reports/detail/outstanding?from=${today}&to=${today}`))
    .body.data.rows;
  expect(outstanding.reduce((s: number, r: { outstanding: number }) => s + r.outstanding, 0)).toBe(
    summary.outstanding,
  );
  const repaid = (await admin.get(`/reports/detail/repayments?from=${today}&to=${today}`)).body.data
    .rows;
  expect(repaid.reduce((s: number, r: { amount: number }) => s + r.amount, 0)).toBe(
    summary.repayments_total,
  );
  const drivers = (await admin.get('/drivers')).body.data;
  const factoryRow = (
    await admin.get(`/reports/detail/factory-credit?from=${today}&to=${today}`)
  ).body.data.rows.find((r: { name: string }) => r.name === 'Ceylon Tea Factory');
  expect(factoryRow.outstanding).toBe(
    drivers
      .filter((d: { factory_id: string }) => d.factory_id === ids.factory)
      .reduce((s: number, d: { outstanding: number }) => s + d.outstanding, 0),
  );
  for (const kind of reportKinds) {
    const response = await admin.get(`/reports/detail/${kind}?from=${today}&to=${today}`);
    expect(response.status, `${kind}: ${response.text}`).toBe(200);
  }
  expect((await till.get(`/reports/business?from=${today}&to=${today}`)).status).toBe(403);
});

it('opens a sealed bag into loose stock with an explicit conversion', async () => {
  const bags = await stockOf(ids.bag50),
    loose = await stockOf(ids.loose);
  const conversion = await admin.post('/inventory/conversions', {
    operationId: randomUUID(),
    fromProductId: ids.bag50,
    quantity: 1000,
    toProductId: ids.loose,
    resultingQuantity: 50000,
    reason: 'Opened for loose sales',
  });
  expect(conversion.status, conversion.text).toBe(201);
  expect(await stockOf(ids.bag50)).toBe(bags - 1000);
  expect(await stockOf(ids.loose)).toBe(loose + 50000);
  const history = (await admin.get(`/products/${ids.loose}/stock-history`)).body.data;
  expect(history[0]).toMatchObject({ type: 'conversion_in', delta: 50000, balance: loose + 50000 });
  expect(
    (
      await admin.post('/inventory/conversions', {
        operationId: randomUUID(),
        fromProductId: ids.bag50,
        quantity: 1000,
        toProductId: ids.sprayer,
        resultingQuantity: 1000,
        reason: 'Wrong',
      })
    ).body.error.code,
  ).toBe('CONVERSION_FAMILY');
});
