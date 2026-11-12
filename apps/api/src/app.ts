import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  id,
  pageSchema,
  permissionsFor,
  roleNames,
  settingsSchema,
  date,
  type Actor,
  reportKinds,
} from '@agripos/shared';
import type { Database } from './database/db';
import type { Authenticate } from './middleware/auth';
import { AppError, assert } from './utils/errors';
import { createCategory, products, saveProduct, saveContact } from './modules/catalog/service';
import { createPurchase, receivePurchase, adjustStock } from './modules/inventory/service';
import { createSale, returnSale } from './modules/sales/service';
import { expense, repay } from './modules/finance/service';
import { summary, trend, inventory, saleDetails } from './modules/reporting/queries';
import { audit, requirePermission } from './services/transactions';
import { openCash, closeCash, moveCash } from './modules/finance/cash';
import { paySupplier } from './modules/finance/suppliers';
import { stocktake } from './modules/inventory/stocktake';
import { park, resume, releasePark } from './modules/sales/parked';
import { provisionOffline, pushOffline } from './modules/sync/service';
import { report } from './modules/reporting/reports';
import { importProducts } from './modules/catalog/import';
import { notifications } from './modules/reporting/notifications';
import { returnToSupplier } from './modules/inventory/supplier-returns';
import { productImage } from './modules/catalog/images';
import { inviteStaff } from './modules/staff/service';
import { orderStatus } from './modules/inventory/orders';
import { correctExpense } from './modules/finance/expense-corrections';
import { account } from './modules/finance/accounts';
import { login, logout, changePassword } from './services/accounts';
export function createApp(db: Database, authenticate: Authenticate) {
  const app = express(),
    log = pino({ enabled: process.env.NODE_ENV !== 'test' });
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: '256kb' }));
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId);
    const started = Date.now();
    res.on('finish', () =>
      log.info(
        {
          requestId: res.locals.requestId,
          method: _req.method,
          path: _req.path,
          status: res.statusCode,
          durationMs: Date.now() - started,
        },
        'request',
      ),
    );
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'agripos-api' }));
  app.post(
    '/api/v1/auth/login',
    rateLimit({
      windowMs: 15 * 60000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    async (req, res, next) => {
      try {
        res.json({ data: await login(db, req.body) });
      } catch (error) {
        next(error);
      }
    },
  );
  app.use(
    '/api/v1',
    rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use('/api/v1', async (req, res, next) => {
    try {
      if (req.path === '/auth/login') return next();
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      assert(token, 401, 'UNAUTHORIZED', 'Sign in to continue');
      res.locals.actor = await authenticate(token);
      next();
    } catch (e) {
      next(e);
    }
  });
  const actor = (res: Response) => res.locals.actor as Actor;
  const route = (
    method: 'get' | 'post' | 'patch',
    path: string,
    fn: (req: Request, res: Response) => Promise<unknown>,
    status = 200,
  ) =>
    app[method](`/api/v1${path}`, async (req, res, next) => {
      try {
        const data = await fn(req, res);
        res.status(status).json({ data });
      } catch (e) {
        next(e);
      }
    });
  route('get', '/auth/me', async (_req, res) => ({
    ...actor(res),
    permissions: permissionsFor(actor(res).role),
  }));
  route('post', '/auth/logout', async (req) => {
    await logout(db, req.headers.authorization!.slice(7));
    return { signedOut: true };
  });
  route('post', '/auth/password', async (req, res) => changePassword(db, actor(res).id, req.body));
  route('patch', '/auth/me', async (req, res) => {
    const a = actor(res);
    const p = z
      .object({ name: z.string().trim().min(1).max(120) })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      await tx.query('UPDATE staff SET name=$3 WHERE shop_id=$1 AND id=$2', [
        a.shopId,
        a.id,
        p.name,
      ]);
      await audit(tx, a, 'profile.update', a.id, p);
    });
    return { ...a, name: p.name, permissions: permissionsFor(a.role) };
  });
  route('get', '/roles', async (_req, res) => {
    requirePermission(actor(res), 'staff.manage');
    return roleNames.map((role) => ({ role, permissions: permissionsFor(role) }));
  });
  route('get', '/permissions', async (_req, res) => permissionsFor(actor(res).role));
  route('get', '/notifications', async (_req, res) => notifications(db, actor(res)));
  route('post', '/notifications/:id/read', async (req, res) => {
    const a = actor(res);
    return (
      await db.query(
        'UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE shop_id=$1 AND staff_id=$2 AND id=$3 RETURNING id',
        [a.shopId, a.id, id.parse(req.params.id)],
      )
    )[0];
  });
  route('post', '/sync/terminals', async (req, res) => {
    const a = actor(res);
    requirePermission(a, 'staff.manage');
    const p = z
      .object({ terminalId: id, name: z.string().min(1).max(100), offlineEnabled: z.boolean() })
      .strict()
      .parse(req.body);
    return db.transaction(async (tx) => {
      const row = (
        await tx.query(
          'INSERT INTO terminals(id,shop_id,name,offline_enabled,authorized_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=excluded.name,offline_enabled=excluded.offline_enabled WHERE terminals.shop_id=excluded.shop_id RETURNING *',
          [p.terminalId, a.shopId, p.name, p.offlineEnabled, a.id],
        )
      )[0];
      assert(row, 403, 'TERMINAL_SHOP', 'Terminal belongs to another shop');
      await audit(tx, a, 'terminal.authorize', p.terminalId, p);
      return row;
    });
  });
  route('post', '/sync/provision', async (req, res) => {
    const p = z.object({ terminalId: id }).strict().parse(req.body);
    return provisionOffline(db, actor(res), p.terminalId, process.env.OFFLINE_SIGNING_KEY);
  });
  route('post', '/sync/push', async (req, res) => pushOffline(db, actor(res), req.body));
  route('get', '/sync/conflicts', async (_req, res) => {
    const a = actor(res);
    requirePermission(a, 'refund.write');
    return db.query(
      "SELECT id,staff_id,state,message,created_at,payload FROM sync_operations WHERE shop_id=$1 AND state<>'synced' ORDER BY created_at LIMIT 200",
      [a.shopId],
    );
  });
  route('post', '/sync/conflicts/:id/resolve', async (req, res) => {
    const a = actor(res);
    requirePermission(a, 'refund.write');
    const p = z.object({ terminalId: id.optional() }).strict().parse(req.body);
    const row = (
      await db.query<{ payload: unknown }>(
        'SELECT payload FROM sync_operations WHERE shop_id=$1 AND id=$2',
        [a.shopId, id.parse(req.params.id)],
      )
    )[0];
    assert(row, 404, 'NOT_FOUND', 'Conflict not found');
    return pushOffline(db, a, row.payload, p.terminalId);
  });
  route('get', '/sync/status', async (_req, res) => {
    const a = actor(res);
    requirePermission(a, 'sales.write');
    return db.query(
      'SELECT state,COUNT(*)::int count FROM sync_operations WHERE shop_id=$1 AND staff_id=$2 GROUP BY state',
      [a.shopId, a.id],
    );
  });
  route('get', '/products', async (req, res) => {
    const p = pageSchema.parse(req.query);
    return products(db, actor(res), p.search, p.limit, p.page);
  });
  route('post', '/products', async (req, res) => saveProduct(db, actor(res), req.body), 201);
  route(
    'post',
    '/products/import',
    async (req, res) => importProducts(db, actor(res), req.body),
    201,
  );
  route('get', '/products/:id/image', async (req, res) =>
    productImage(db, actor(res), id.parse(req.params.id)),
  );
  route('get', '/settings/logo', async (_req, res) => productImage(db, actor(res), 'logo'));
  route('post', '/settings/logo', async (req, res) =>
    productImage(db, actor(res), 'logo', req.body),
  );
  route('post', '/products/:id/image', async (req, res) =>
    productImage(db, actor(res), id.parse(req.params.id), req.body),
  );
  route('post', '/staff/invite', async (req, res) => inviteStaff(db, actor(res), req.body), 201);
  route('post', '/purchases/:id/status', async (req, res) =>
    orderStatus(db, actor(res), id.parse(req.params.id), req.body),
  );
  route('post', '/sales/park/:id/release', async (req, res) =>
    releasePark(db, actor(res), id.parse(req.params.id), req.body),
  );
  route('post', '/sales/park/:id/cancel', async (req, res) =>
    releasePark(db, actor(res), id.parse(req.params.id), req.body, true),
  );
  route(
    'post',
    '/inventory/supplier-returns',
    async (req, res) => returnToSupplier(db, actor(res), req.body),
    201,
  );
  route('get', '/products/:id', async (req, res) => {
    const a = actor(res);
    requirePermission(a, 'catalog.read');
    const productId = id.parse(req.params.id);
    const row = (
      await db.query<{ sku: string }>('SELECT sku FROM products WHERE shop_id=$1 AND id=$2', [
        a.shopId,
        productId,
      ])
    )[0];
    assert(row, 404, 'NOT_FOUND', 'Product not found');
    return (await products(db, a, row.sku, 100)).items.find((p) => p.id === productId);
  });
  route('patch', '/products/:id', async (req, res) =>
    saveProduct(db, actor(res), req.body, id.parse(req.params.id)),
  );
  route('get', '/categories', async (_req, res) => {
    requirePermission(actor(res), 'catalog.read');
    return db.query('SELECT * FROM categories WHERE shop_id=$1 ORDER BY name', [actor(res).shopId]);
  });
  route('post', '/categories', async (req, res) => createCategory(db, actor(res), req.body), 201);
  for (const kind of ['suppliers', 'customers'] as const) {
    route('get', `/${kind}/:id/account`, async (req, res) =>
      account(db, actor(res), kind, id.parse(req.params.id)),
    );
    route('get', `/${kind}`, async (req, res) => {
      const a = actor(res);
      requirePermission(a, kind === 'suppliers' ? 'purchases.write' : 'customers.write');
      const p = pageSchema.parse(req.query);
      return db.query(
        `SELECT t.*,COALESCE((SELECT SUM(amount) FROM ${kind === 'customers' ? 'customer_ledger' : 'supplier_ledger'} l WHERE l.${kind === 'customers' ? 'customer_id' : 'supplier_id'}=t.id),0)::bigint balance FROM ${kind} t WHERE shop_id=$1 AND (name ILIKE $2 OR phone ILIKE $2) ORDER BY name LIMIT $3 OFFSET $4`,
        [a.shopId, `%${p.search}%`, p.limit, (p.page - 1) * p.limit],
      );
    });
    route('post', `/${kind}`, async (req, res) => saveContact(db, actor(res), kind, req.body), 201);
    route('patch', `/${kind}/:id`, async (req, res) =>
      saveContact(db, actor(res), kind, req.body, id.parse(req.params.id)),
    );
  }
  route('get', '/inventory', async (req, res) => {
    const p = pageSchema.parse(req.query);
    return inventory(db, actor(res), p.limit, p.page);
  });
  route(
    'post',
    '/inventory/stocktakes',
    async (req, res) => stocktake(db, actor(res), req.body),
    201,
  );
  route('get', '/suppliers/:id/ledger', async (req, res) => {
    requirePermission(actor(res), 'purchases.write');
    return db.query(
      'SELECT * FROM supplier_ledger WHERE shop_id=$1 AND supplier_id=$2 ORDER BY created_at DESC',
      [actor(res).shopId, id.parse(req.params.id)],
    );
  });
  route(
    'post',
    '/supplier-payments',
    async (req, res) => paySupplier(db, actor(res), req.body),
    201,
  );
  route('get', '/inventory/movements', async (_req, res) => {
    requirePermission(actor(res), 'inventory.write');
    return db.query(
      'SELECT m.*,p.name,b.batch_number FROM inventory_movements m JOIN batches b ON b.id=m.batch_id JOIN products p ON p.id=b.product_id WHERE m.shop_id=$1 ORDER BY m.created_at DESC LIMIT 200',
      [actor(res).shopId],
    );
  });
  route(
    'post',
    '/inventory/adjustments',
    async (req, res) => adjustStock(db, actor(res), req.body),
    201,
  );
  route('get', '/purchases', async (req, res) => {
    const p = pageSchema.parse(req.query);
    requirePermission(actor(res), 'purchases.write');
    return db.query(
      'SELECT p.*,s.name supplier FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.shop_id=$1 ORDER BY p.created_at DESC,p.id LIMIT $2 OFFSET $3',
      [actor(res).shopId, p.limit, (p.page - 1) * p.limit],
    );
  });
  route('post', '/purchases', async (req, res) => createPurchase(db, actor(res), req.body), 201);
  route('get', '/purchases/:id', async (req, res) => {
    const a = actor(res);
    requirePermission(a, 'purchases.write');
    const purchaseId = id.parse(req.params.id);
    const order = (
      await db.query('SELECT * FROM purchases WHERE shop_id=$1 AND id=$2', [a.shopId, purchaseId])
    )[0];
    assert(order, 404, 'NOT_FOUND', 'Purchase not found');
    return {
      ...order,
      lines: await db.query(
        'SELECT l.*,p.name FROM purchase_lines l JOIN products p ON p.id=l.product_id WHERE l.shop_id=$1 AND l.purchase_id=$2',
        [a.shopId, purchaseId],
      ),
    };
  });
  route('post', '/purchases/:id/receive', async (req, res) =>
    receivePurchase(db, actor(res), id.parse(req.params.id), req.body),
  );
  route('post', '/sales', async (req, res) => createSale(db, actor(res), req.body), 201);
  route('get', '/sales', async (req, res) => {
    const a = actor(res);
    requirePermission(a, 'sales.write');
    const p = pageSchema.parse(req.query);
    return db.query(
      'SELECT id,total,status,credit,created_at FROM sales WHERE shop_id=$1 AND id::text ILIKE $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4',
      [a.shopId, `%${p.search}%`, p.limit, (p.page - 1) * p.limit],
    );
  });
  route('get', '/sales/park', async (_req, res) => {
    const a = actor(res);
    requirePermission(a, 'sales.write');
    return db.query(
      "SELECT id,label,status,created_at FROM parked_sales WHERE shop_id=$1 AND (status='parked' OR status='resumed' AND claimed_by=$2) ORDER BY created_at",
      [a.shopId, a.id],
    );
  });
  route('post', '/sales/park', async (req, res) => park(db, actor(res), req.body), 201);
  route('post', '/sales/park/:id/resume', async (req, res) =>
    resume(db, actor(res), id.parse(req.params.id)),
  );
  for (const path of ['/sales/:id', '/sales/:id/receipt'])
    route('get', path, async (req, res) => {
      const sale = await saleDetails(db, actor(res), id.parse(req.params.id));
      assert(sale, 404, 'NOT_FOUND', 'Sale not found');
      return sale;
    });
  route(
    'post',
    '/sales/:id/returns',
    async (req, res) => returnSale(db, actor(res), id.parse(req.params.id), req.body),
    201,
  );
  route('get', '/customers/:id/ledger', async (req, res) => {
    requirePermission(actor(res), 'payments.write');
    return db.query(
      'SELECT * FROM customer_ledger WHERE shop_id=$1 AND customer_id=$2 ORDER BY created_at DESC',
      [actor(res).shopId, id.parse(req.params.id)],
    );
  });
  route(
    'post',
    '/customers/:id/payments',
    async (req, res) => repay(db, actor(res), id.parse(req.params.id), req.body),
    201,
  );
  route('get', '/expenses', async (req, res) => {
    const p = pageSchema.parse(req.query);
    requirePermission(actor(res), 'expenses.write');
    return db.query(
      'SELECT * FROM expenses WHERE shop_id=$1 ORDER BY date DESC,id LIMIT $2 OFFSET $3',
      [actor(res).shopId, p.limit, (p.page - 1) * p.limit],
    );
  });
  route('post', '/expenses', async (req, res) => expense(db, actor(res), req.body), 201);
  route('post', '/expenses/:id/correct', async (req, res) =>
    correctExpense(db, actor(res), id.parse(req.params.id), req.body),
  );
  route('get', '/cash-sessions', async (req, res) => {
    const p = pageSchema.parse(req.query);
    const a = actor(res);
    requirePermission(a, 'sales.write');
    return db.query(
      'SELECT c.*,COALESCE((SELECT SUM(amount) FROM cash_movements m WHERE m.session_id=c.id),0)::bigint movements FROM cash_sessions c WHERE c.shop_id=$1 AND (c.opened_by=$2 OR $3) ORDER BY c.opened_at DESC,c.id LIMIT $4 OFFSET $5',
      [
        a.shopId,
        a.id,
        a.role === 'administrator' || a.role === 'manager',
        p.limit,
        (p.page - 1) * p.limit,
      ],
    );
  });
  route('post', '/cash-sessions/open', async (req, res) => openCash(db, actor(res), req.body), 201);
  route('post', '/cash-sessions/:id/close', async (req, res) =>
    closeCash(db, actor(res), id.parse(req.params.id), req.body),
  );
  route(
    'post',
    '/cash-sessions/movements',
    async (req, res) => moveCash(db, actor(res), req.body),
    201,
  );
  route('get', '/dashboard/summary', async (_req, res) => summary(db, actor(res)));
  route('get', '/dashboard/stock-status', async (_req, res) => {
    const a = actor(res);
    requirePermission(a, 'catalog.read');
    const rows = (
      await db.query<{ healthy: number; low: number; out: number }>(
        `SELECT COUNT(*) FILTER(WHERE stock>minimum_stock)::int healthy,COUNT(*) FILTER(WHERE stock>0 AND stock<=minimum_stock)::int low,COUNT(*) FILTER(WHERE stock=0)::int out FROM(SELECT p.minimum_stock,COALESCE(SUM(b.quantity) FILTER(WHERE b.expiry_date IS NULL OR b.expiry_date>=(now() AT TIME ZONE 'Asia/Colombo')::date),0) stock FROM products p LEFT JOIN batches b ON b.product_id=p.id WHERE p.shop_id=$1 AND p.active GROUP BY p.id) t`,
        [a.shopId],
      )
    )[0]!;
    return [
      { name: 'Healthy', value: rows.healthy },
      { name: 'Low stock', value: rows.low },
      { name: 'Out of stock', value: rows.out },
    ];
  });
  route('get', '/inventory/expiring', async (_req, res) => {
    const a = actor(res);
    requirePermission(a, 'catalog.read');
    return db.query(
      `SELECT b.id,p.name,b.expiry_date,b.quantity FROM batches b JOIN products p ON p.id=b.product_id JOIN shops s ON s.id=b.shop_id WHERE b.shop_id=$1 AND b.quantity>0 AND b.expiry_date<=(now() AT TIME ZONE 'Asia/Colombo')::date+s.expiry_alert_days ORDER BY b.expiry_date LIMIT 1000`,
      [a.shopId],
    );
  });
  route('get', '/dashboard/activity', async (_req, res) => {
    const a = actor(res);
    requirePermission(a, 'staff.manage');
    return db.query(
      'SELECT a.id,a.action,a.created_at,s.name FROM audit_logs a JOIN staff s ON s.id=a.actor_id WHERE a.shop_id=$1 ORDER BY a.created_at DESC LIMIT 10',
      [a.shopId],
    );
  });
  route('get', '/dashboard/sales-trend', async (req, res) =>
    trend(db, actor(res), date.parse(req.query.from), date.parse(req.query.to)),
  );
  route('get', '/dashboard/alerts', async (_req, res) => {
    const a = actor(res);
    requirePermission(a, 'catalog.read');
    return db.query(
      `SELECT p.id,p.name,COALESCE(SUM(b.quantity) FILTER(WHERE b.expiry_date IS NULL OR b.expiry_date >= (now() AT TIME ZONE 'Asia/Colombo')::date),0)::bigint stock,p.minimum_stock FROM products p LEFT JOIN batches b ON b.product_id=p.id WHERE p.shop_id=$1 AND p.active GROUP BY p.id HAVING COALESCE(SUM(b.quantity) FILTER(WHERE b.expiry_date IS NULL OR b.expiry_date >= (now() AT TIME ZONE 'Asia/Colombo')::date),0)<=p.minimum_stock ORDER BY p.name LIMIT 100`,
      [a.shopId],
    );
  });
  route('get', '/reports/sales', async (req, res) =>
    trend(db, actor(res), date.parse(req.query.from), date.parse(req.query.to)),
  );
  route('get', '/reports/detail/:kind', async (req, res) =>
    report(
      db,
      actor(res),
      z.enum(reportKinds).parse(req.params.kind),
      date.parse(req.query.from),
      date.parse(req.query.to),
    ),
  );
  route('get', '/reports/profit', async (req, res) => {
    const a = actor(res);
    requirePermission(a, 'profit.read');
    const from = date.parse(req.query.from),
      to = date.parse(req.query.to);
    assert(
      from <= to && Date.parse(to) - Date.parse(from) <= 366 * 86400000,
      422,
      'DATE_RANGE',
      'Choose a date range of at most one year',
    );
    const sales = (
      await db.query(
        `SELECT COALESCE(SUM(total-tax),0)::bigint net_revenue,COALESCE(SUM(cost),0)::bigint cost,COALESCE(SUM(total-tax-cost),0)::bigint gross_profit FROM financial_events WHERE shop_id=$1 AND (created_at AT TIME ZONE 'Asia/Colombo')::date BETWEEN $2 AND $3`,
        [a.shopId, from, to],
      )
    )[0]!;
    const expenses = (
      await db.query(
        'SELECT COALESCE(SUM(amount),0)::bigint expenses FROM expenses WHERE shop_id=$1 AND voided_at IS NULL AND date BETWEEN $2 AND $3',
        [a.shopId, from, to],
      )
    )[0]!;
    return {
      ...sales,
      ...expenses,
      net_profit_estimate: Number(sales.gross_profit) - Number(expenses.expenses),
    };
  });
  route(
    'get',
    '/settings',
    async (_req, res) =>
      (await db.query('SELECT * FROM shops WHERE id=$1', [actor(res).shopId]))[0],
  );
  route('patch', '/settings', async (req, res) => {
    const a = actor(res);
    requirePermission(a, 'settings.write');
    const p = settingsSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const result = (
        await tx.query(
          'UPDATE shops SET name=$2,address=$3,phone=$4,receipt_footer=$5,expiry_alert_days=$6,require_cash_session=$7 WHERE id=$1 RETURNING *',
          [
            a.shopId,
            p.name,
            p.address,
            p.phone,
            p.receiptFooter,
            p.expiryAlertDays,
            p.requireCashSession,
          ],
        )
      )[0];
      await audit(tx, a, 'settings.update', a.shopId);
      await tx.query(
        'UPDATE shops SET email=$2,registration_number=$3,tax_number=$4,default_tax_bps=$5,invoice_prefix=$6 WHERE id=$1',
        [a.shopId, p.email, p.registrationNumber, p.taxNumber, p.defaultTaxBps, p.invoicePrefix],
      );
      return result;
    });
  });
  route('get', '/staff', async (_req, res) => {
    requirePermission(actor(res), 'staff.manage');
    return db.query(
      'SELECT id,name,username,role,active FROM staff WHERE shop_id=$1 ORDER BY name',
      [actor(res).shopId],
    );
  });
  route('patch', '/staff/:id', async (req, res) => {
    const a = actor(res);
    requirePermission(a, 'staff.manage');
    const staffId = id.parse(req.params.id),
      p = z
        .object({ role: z.enum(roleNames), active: z.boolean() })
        .strict()
        .parse(req.body);
    assert(
      staffId !== a.id,
      409,
      'SELF_CHANGE',
      'Ask another administrator to change your own access',
    );
    return db.transaction(async (tx) => {
      await tx.query('SELECT id FROM shops WHERE id=$1 FOR UPDATE', [a.shopId]);
      const result = (
        await tx.query(
          'UPDATE staff SET role=$3,active=$4 WHERE shop_id=$1 AND id=$2 RETURNING id,name,role,active',
          [a.shopId, staffId, p.role, p.active],
        )
      )[0];
      assert(result, 404, 'NOT_FOUND', 'Staff not found');
      await tx.query('DELETE FROM auth_sessions WHERE staff_id=$1', [staffId]);
      await audit(tx, a, 'staff.permissions', staffId, p);
      return result;
    });
  });
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let status = 500,
      code = 'INTERNAL_ERROR',
      message = 'The operation could not be completed';
    if (err instanceof AppError) {
      status = err.status;
      code = err.code;
      message = err.message;
    } else if (err instanceof z.ZodError) {
      status = 422;
      code = 'VALIDATION_ERROR';
      message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } else if (err && typeof err === 'object' && 'code' in err) {
      if (err.code === '23505') {
        status = 409;
        code = 'DUPLICATE';
        message = 'A record with these details already exists';
      }
      if (err.code === '23503') {
        status = 422;
        code = 'INVALID_REFERENCE';
        message = 'A selected record does not belong to this shop or no longer exists';
      }
      if (err.code === '23514') {
        status = 422;
        code = 'INVALID_VALUE';
        message = 'The values violate a business constraint';
      }
    }
    if (err instanceof SyntaxError) {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Invalid JSON request';
    }
    if (status === 500)
      log.error(
        { requestId: res.locals.requestId, error: err instanceof Error ? err.name : 'Unknown' },
        'Request failed',
      );
    res.status(status).json({ error: { code, message, requestId: res.locals.requestId } });
  });
  return app;
}
