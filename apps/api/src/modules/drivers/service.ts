import { driverSchema, factorySchema, monthlyDue, type Actor, type Report } from '@agripos/shared';
import type { Connection, Database } from '../../database/db';
import { audit, requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
import {
  customerBalances,
  installmentRows,
  invoiceOutstanding,
  paymentType,
  TODAY,
} from '../credit/queries';

const like = (search: string) => `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listFactories(db: Database, actor: Actor, search = '') {
  requirePermission(actor, 'customers.write');
  return db.query(
    `SELECT f.*,
      (SELECT COUNT(*)::int FROM customers c WHERE c.factory_id=f.id AND c.kind='driver') drivers,
      COALESCE((SELECT SUM(l.amount) FROM customer_ledger l JOIN customers c ON c.id=l.customer_id WHERE c.factory_id=f.id AND c.kind='driver'),0)::bigint outstanding,
      COALESCE((SELECT SUM(ib.remaining) FROM installment_balances ib JOIN sales s ON s.id=ib.sale_id JOIN customers c ON c.id=s.customer_id WHERE c.factory_id=f.id AND c.kind='driver' AND ib.remaining>0 AND ib.due_date<${TODAY}),0)::bigint overdue
     FROM factories f WHERE f.shop_id=$1 AND (f.name ILIKE $2 OR f.phone ILIKE $2) ORDER BY f.active DESC,f.name LIMIT 500`,
    [actor.shopId, like(search)],
  );
}

export async function saveFactory(db: Database, actor: Actor, input: unknown, factoryId?: string) {
  requirePermission(actor, 'customers.write');
  const p = factorySchema.parse(input);
  return db.transaction(async (tx) => {
    const rows = factoryId
      ? await tx.query(
          'UPDATE factories SET name=$3,address=$4,phone=$5,notes=$6,active=$7 WHERE shop_id=$1 AND id=$2 RETURNING *',
          [actor.shopId, factoryId, p.name, p.address, p.phone, p.notes, p.active],
        )
      : await tx.query(
          'INSERT INTO factories(shop_id,name,address,phone,notes,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
          [actor.shopId, p.name, p.address, p.phone, p.notes, p.active],
        );
    assert(rows[0], 404, 'NOT_FOUND', 'Factory not found');
    await audit(tx, actor, factoryId ? 'factory.update' : 'factory.create', String(rows[0].id), p);
    return rows[0];
  });
}

export async function listDrivers(
  db: Database,
  actor: Actor,
  options: { search?: string; factoryId?: string; limit?: number; page?: number } = {},
) {
  requirePermission(actor, 'customers.write');
  const limit = options.limit ?? 100,
    page = options.page ?? 1;
  return db.query(
    `SELECT c.id,c.name,c.driver_code,c.lorry_number,c.phone,c.address,c.notes,c.active,c.registered_at,
      f.id factory_id,f.name factory,${customerBalances('c')}
     FROM customers c JOIN factories f ON f.id=c.factory_id
     WHERE c.shop_id=$1 AND c.kind='driver' AND ($2::uuid IS NULL OR c.factory_id=$2)
      AND (c.name ILIKE $3 OR c.driver_code ILIKE $3 OR c.lorry_number ILIKE $3 OR c.phone ILIKE $3 OR f.name ILIKE $3)
     ORDER BY c.active DESC,c.name,c.driver_code LIMIT $4 OFFSET $5`,
    [
      actor.shopId,
      options.factoryId ?? null,
      like(options.search ?? ''),
      limit,
      (page - 1) * limit,
    ],
  );
}

async function activeFactory(tx: Connection, actor: Actor, factoryId: string) {
  const factory = (
    await tx.query<{ active: boolean }>('SELECT active FROM factories WHERE shop_id=$1 AND id=$2', [
      actor.shopId,
      factoryId,
    ])
  )[0];
  assert(factory, 404, 'NOT_FOUND', 'Factory not found');
  return factory;
}

export async function saveDriver(db: Database, actor: Actor, input: unknown, driverId?: string) {
  requirePermission(actor, 'customers.write');
  const p = driverSchema.parse(input);
  return db.transaction(async (tx) => {
    await tx.query('SELECT id FROM shops WHERE id=$1 FOR UPDATE', [actor.shopId]);
    const factory = await activeFactory(tx, actor, p.factoryId);
    if (!driverId) assert(factory.active, 409, 'FACTORY_INACTIVE', 'Choose an active factory');
    const duplicate = (
      await tx.query<{ driver_code: string }>(
        "SELECT driver_code FROM customers WHERE shop_id=$1 AND kind='driver' AND factory_id=$2 AND lower(trim(name))=lower(trim($3)) AND ($4::uuid IS NULL OR id<>$4) LIMIT 1",
        [actor.shopId, p.factoryId, p.name, driverId ?? null],
      )
    )[0];
    assert(
      !duplicate || p.confirmDuplicate,
      409,
      'DUPLICATE_DRIVER',
      `A driver with this name is already registered at this factory (${duplicate?.driver_code}). Confirm to add another person with the same name.`,
    );
    let row;
    if (driverId) {
      row = (
        await tx.query(
          "UPDATE customers SET name=$3,factory_id=$4,lorry_number=$5,phone=$6,address=$7,notes=$8,active=$9 WHERE shop_id=$1 AND id=$2 AND kind='driver' RETURNING *",
          [
            actor.shopId,
            driverId,
            p.name,
            p.factoryId,
            p.lorryNumber,
            p.phone,
            p.address,
            p.notes,
            p.active,
          ],
        )
      )[0];
      assert(row, 404, 'NOT_FOUND', 'Driver not found');
    } else {
      const next = (
        await tx.query<{ n: number }>(
          "SELECT (COALESCE(MAX(substring(driver_code FROM 5)::int),0)+1)::int n FROM customers WHERE shop_id=$1 AND kind='driver' AND driver_code ~ '^DRV-[0-9]+$'",
          [actor.shopId],
        )
      )[0]!.n;
      row = (
        await tx.query(
          "INSERT INTO customers(shop_id,kind,name,factory_id,driver_code,lorry_number,phone,address,notes,active,credit_limit,credit_enabled) VALUES($1,'driver',$2,$3,$4,$5,$6,$7,$8,$9,NULL,true) RETURNING *",
          [
            actor.shopId,
            p.name,
            p.factoryId,
            `DRV-${String(next).padStart(4, '0')}`,
            p.lorryNumber,
            p.phone,
            p.address,
            p.notes,
            p.active,
          ],
        )
      )[0]!;
    }
    await audit(tx, actor, driverId ? 'driver.update' : 'driver.create', String(row.id), p);
    return row;
  });
}

/** Totals, invoices, payments and schedules for one credit customer, all derived from records. */
export async function creditProfile(db: Database, actor: Actor, customerId: string) {
  requirePermission(actor, 'payments.write');
  const customer = (
    await db.query(
      `SELECT c.*,f.name factory,f.phone factory_phone,f.address factory_address,${customerBalances('c')}
       FROM customers c LEFT JOIN factories f ON f.id=c.factory_id WHERE c.shop_id=$1 AND c.id=$2`,
      [actor.shopId, customerId],
    )
  )[0];
  assert(customer, 404, 'NOT_FOUND', 'Customer not found');
  const totals = (
    await db.query(
      `SELECT COUNT(*)::int invoices,COALESCE(SUM(s.subtotal),0)::bigint gross,COALESCE(SUM(s.discount),0)::bigint discounts,
        COALESCE(SUM(s.total),0)::bigint purchases,COALESCE(SUM(s.total-s.credit),0)::bigint paid_at_sale,
        COALESCE(SUM(s.credit),0)::bigint credit_issued,
        COUNT(*) FILTER(WHERE s.credit=0)::int cash_invoices,COUNT(*) FILTER(WHERE s.credit>0 AND s.credit=s.total)::int credit_invoices,
        COUNT(*) FILTER(WHERE s.credit>0 AND s.credit<s.total)::int mixed_invoices,
        COALESCE((SELECT -SUM(l.amount) FROM customer_ledger l WHERE l.customer_id=$2 AND l.type='repayment'),0)::bigint credit_paid,
        COALESCE((SELECT -SUM(l.amount) FROM customer_ledger l WHERE l.customer_id=$2 AND l.type='return'),0)::bigint credit_returned
       FROM sales s WHERE s.shop_id=$1 AND s.customer_id=$2`,
      [actor.shopId, customerId],
    )
  )[0]!;
  const installments = await db.query<{ due_date: string; remaining: number; status: string }>(
    `${installmentRows} WHERE ib.shop_id=$1 AND c.id=$2 ORDER BY ib.due_date,s.created_at,ib.seq`,
    [actor.shopId, customerId],
  );
  const invoices = await db.query(
    `SELECT s.id,s.invoice_number,s.created_at,s.subtotal,s.discount,s.bill_discount,s.total,s.credit,s.status,s.due_date::text due_date,
      (s.total-s.credit)::bigint paid_at_sale,${invoiceOutstanding('s')} outstanding,${paymentType} payment_type
     FROM sales s WHERE s.shop_id=$1 AND s.customer_id=$2 ORDER BY s.created_at DESC LIMIT 1000`,
    [actor.shopId, customerId],
  );
  const payments = await db.query(
    `SELECT l.id,l.created_at,(-l.amount)::bigint amount,COALESCE(l.method,split_part(l.reference,':',1)) method,l.notes,
      (SELECT string_agg(s.invoice_number,', ' ORDER BY s.invoice_number) FROM repayment_allocations a JOIN sales s ON s.id=a.sale_id WHERE a.ledger_id=l.id) invoices
     FROM customer_ledger l WHERE l.shop_id=$1 AND l.customer_id=$2 AND l.type='repayment' ORDER BY l.created_at DESC LIMIT 1000`,
    [actor.shopId, customerId],
  );
  const open = installments.map((i) => ({ ...i, dueDate: i.due_date }));
  return {
    customer,
    totals,
    installments,
    monthly: monthlyDue(open).map((m) => ({
      month: m.month,
      amount: m.amount,
      installments: m.items.length,
    })),
    invoices,
    payments,
  };
}

export async function factoryDetails(db: Database, actor: Actor, factoryId: string) {
  requirePermission(actor, 'customers.write');
  const factory = (
    await db.query('SELECT * FROM factories WHERE shop_id=$1 AND id=$2', [actor.shopId, factoryId])
  )[0];
  assert(factory, 404, 'NOT_FOUND', 'Factory not found');
  const drivers = await listDrivers(db, actor, { factoryId, limit: 1000 });
  const upcoming = await db.query(
    `SELECT * FROM (${installmentRows} WHERE ib.shop_id=$1 AND c.factory_id=$2 AND c.kind='driver') t WHERE remaining>0 ORDER BY due_date,customer_name LIMIT 500`,
    [actor.shopId, factoryId],
  );
  const sales = await db.query(
    `SELECT s.id,s.invoice_number,s.created_at,s.total,s.credit,s.discount,s.status,c.name driver,c.driver_code,${paymentType} payment_type
     FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.shop_id=$1 AND c.factory_id=$2 AND c.kind='driver'
     ORDER BY s.created_at DESC LIMIT 200`,
    [actor.shopId, factoryId],
  );
  const total = (rows: Record<string, unknown>[], key: string) =>
    rows.reduce((sum, r) => sum + Number(r[key] ?? 0), 0);
  return {
    factory,
    drivers,
    upcoming,
    sales,
    totals: {
      drivers: drivers.length,
      active_drivers: drivers.filter((d) => d.active).length,
      outstanding: total(drivers, 'outstanding'),
      overdue: total(drivers, 'overdue'),
      upcoming: total(
        upcoming.filter((r) => r.status !== 'overdue'),
        'remaining',
      ),
    },
  };
}

export async function factoryReport(
  db: Database,
  actor: Actor,
  factoryId: string,
): Promise<Report> {
  const details = await factoryDetails(db, actor, factoryId);
  return {
    title: `${String(details.factory.name)} — driver credit`,
    columns: [
      { key: 'driver_code', label: 'Driver ID' },
      { key: 'name', label: 'Driver' },
      { key: 'lorry_number', label: 'Lorry' },
      { key: 'outstanding', label: 'Outstanding', format: 'money' },
      { key: 'overdue', label: 'Overdue', format: 'money' },
      { key: 'next_due', label: 'Next due', format: 'date' },
    ],
    rows: details.drivers,
    truncated: false,
  };
}
