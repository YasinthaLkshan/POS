import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
it('moves existing credit invoices onto installments without changing any balance', async () => {
  const pg = new PGlite();
  try {
    const files = (await readdir('supabase/migrations')).filter((n) => n.endsWith('.sql')).sort();
    const apply = async (names: string[]) => {
      for (const name of names)
        await pg.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
    };
    await apply(files.filter((n) => n < '014'));
    const shop = randomUUID(),
      staff = randomUUID(),
      customer = randomUUID(),
      sale = randomUUID(),
      paidSale = randomUUID(),
      repayment = randomUUID(),
      returned = randomUUID();
    await pg.query("INSERT INTO shops(id,name) VALUES($1,'Legacy shop')", [shop]);
    await pg.query(
      "INSERT INTO staff(id,shop_id,name,role) VALUES($1,$2,'Owner','administrator')",
      [staff, shop],
    );
    await pg.query(
      "INSERT INTO customers(id,shop_id,name,credit_limit) VALUES($1,$2,'Old customer',5000000)",
      [customer, shop],
    );
    for (const [id, credit] of [
      [sale, 1000000],
      [paidSale, 0],
    ] as const)
      await pg.query(
        'INSERT INTO sales(id,shop_id,terminal_id,customer_id,cashier_id,subtotal,discount,tax,total,cost,credit,due_date,invoice_number) VALUES($1,$2,$3,$4,$5,1500000,0,0,1500000,0,$6,$7,$8)',
        [
          id,
          shop,
          randomUUID(),
          customer,
          staff,
          credit,
          credit ? '2026-02-01' : null,
          `AGR-${id}`,
        ],
      );
    await pg.query(
      "INSERT INTO customer_ledger(shop_id,customer_id,sale_id,amount,type,actor_id) VALUES($1,$2,$3,1000000,'credit_sale',$4)",
      [shop, customer, sale, staff],
    );
    await pg.query(
      "INSERT INTO customer_ledger(id,shop_id,customer_id,amount,type,reference,actor_id) VALUES($1,$2,$3,-300000,'repayment','cash: ',$4)",
      [repayment, shop, customer, staff],
    );
    await pg.query(
      'INSERT INTO repayment_allocations(shop_id,ledger_id,sale_id,amount) VALUES($1,$2,$3,300000)',
      [shop, repayment, sale],
    );
    await pg.query(
      "INSERT INTO returns(id,shop_id,sale_id,reason,restock,refund_amount,credit_amount,total_amount,actor_id) VALUES($1,$2,$3,'Wrong item',false,0,200000,200000,$4)",
      [returned, shop, sale, staff],
    );
    await pg.query(
      "INSERT INTO customer_ledger(shop_id,customer_id,sale_id,amount,type,actor_id) VALUES($1,$2,$3,-200000,'return',$4)",
      [shop, customer, sale, staff],
    );
    const legacy = async () =>
      (
        await pg.query<{ due: number }>(
          'SELECT (s.credit-COALESCE((SELECT SUM(a.amount) FROM repayment_allocations a WHERE a.sale_id=s.id),0)-COALESCE((SELECT SUM(r.credit_amount) FROM returns r WHERE r.sale_id=s.id),0))::int due FROM sales s WHERE s.id=$1',
          [sale],
        )
      ).rows[0]!.due;
    const before = await legacy();
    await apply(files.filter((n) => n >= '014'));
    expect(await legacy()).toBe(before);
    const installments = (
      await pg.query<{
        seq: number;
        due_date: unknown;
        amount: number;
        paid: number;
        reduced: number;
        remaining: number;
      }>(
        'SELECT seq,due_date::text due_date,amount::int amount,paid::int paid,reduced::int reduced,remaining::int remaining FROM installment_balances ORDER BY sale_id',
      )
    ).rows;
    expect(installments).toEqual([
      {
        seq: 1,
        due_date: '2026-02-01',
        amount: 1000000,
        paid: 300000,
        reduced: 200000,
        remaining: 500000,
      },
    ]);
    expect(before).toBe(500000);
    const customerRow = (
      await pg.query<{ kind: string; credit_limit: number }>(
        'SELECT kind,credit_limit::int credit_limit FROM customers WHERE id=$1',
        [customer],
      )
    ).rows[0];
    expect(customerRow).toEqual({ kind: 'registered', credit_limit: 5000000 });
    expect(
      (await pg.query<{ name: string }>('SELECT customer_name name FROM sales WHERE id=$1', [sale]))
        .rows[0]?.name,
    ).toBe('Old customer');
    await expect(pg.query('DELETE FROM credit_installments')).rejects.toThrow('immutable');
  } finally {
    await pg.close();
  }
});
