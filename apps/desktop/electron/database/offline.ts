import Database from 'better-sqlite3';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import {
  lineTotals,
  saleSchema,
  type OfflineGrant,
  type OfflineOperation,
  type ApiRequest,
  type SyncResult,
} from '@agripos/shared';

type Codec = { encrypt(value: string): Buffer; decrypt(value: Buffer): string };
type QueueRow = {
  id: string;
  payload: Buffer;
  state: string;
  message: string;
  attempts: number;
  next_attempt: number;
};
export class OfflineStore {
  private db: Database.Database;
  private grant: OfflineGrant | null = null;
  constructor(
    path: string,
    private codec: Codec,
    private clock = () => Date.now(),
  ) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS authorization(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, value BLOB NOT NULL, salt TEXT NOT NULL, verifier TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, last_seen INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stock(id TEXT PRIMARY KEY, quantity INTEGER NOT NULL CHECK(quantity>=0));
      CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, owner TEXT NOT NULL, fingerprint TEXT NOT NULL, value BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY REFERENCES receipts(id), owner TEXT NOT NULL, payload BLOB NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, receipt_id TEXT, event TEXT NOT NULL, at INTEGER NOT NULL);`);
    this.db.prepare("UPDATE queue SET state='pending' WHERE state='syncing'").run();
  }
  close() {
    this.grant = null;
    this.db.close();
  }
  lock() {
    this.grant = null;
  }
  get unlocked() {
    return this.grant !== null;
  }
  cachedOwner(apiUrl: string) {
    const row = this.db.prepare('SELECT owner FROM authorization WHERE id=1').get() as
      { owner: string } | undefined;
    return row?.owner.startsWith(`${apiUrl}|`) ? row.owner : null;
  }
  private encode(value: unknown) {
    return this.codec.encrypt(JSON.stringify(value));
  }
  private decode<T>(value: Buffer): T {
    return JSON.parse(this.codec.decrypt(value)) as T;
  }
  status(owner: string) {
    const grant = this.db.prepare('SELECT value FROM authorization WHERE owner=?').get(owner) as
      { value: Buffer } | undefined;
    const counts = this.db
      .prepare('SELECT state,COUNT(*) count FROM queue WHERE owner=? GROUP BY state')
      .all(owner) as { state: string; count: number }[];
    const snapshot = grant ? this.decode<OfflineGrant>(grant.value) : null;
    return {
      authorized: !!snapshot,
      unlocked: this.unlocked,
      expiresAt: snapshot?.expiresAt ?? null,
      staffName: snapshot?.actor.name ?? null,
      lastSyncedAt: (
        this.db
          .prepare(
            "SELECT MAX(e.at) at FROM events e JOIN queue q ON q.id=e.receipt_id WHERE q.owner=? AND e.event='sync.synced'",
          )
          .get(owner) as { at: number | null }
      ).at,
      counts: Object.fromEntries(counts.map((r) => [r.state, r.count])),
      operations: this.db
        .prepare(
          "SELECT id,state,message,attempts FROM queue WHERE owner=? AND state<>'synced' ORDER BY rowid",
        )
        .all(owner) as { id: string; state: string; message: string; attempts: number }[],
    };
  }
  provision(owner: string, grant: OfflineGrant, pin: string) {
    if (!/^\d{8,12}$/.test(pin)) throw new Error('Choose an offline PIN containing 8 to 12 digits');
    const unresolved = this.db
      .prepare("SELECT COUNT(*) count FROM queue WHERE state<>'synced'")
      .get() as { count: number };
    if (unresolved.count)
      throw new Error(
        'Synchronize or reconcile every local receipt before replacing offline authorization',
      );
    const salt = randomBytes(32).toString('hex'),
      verifier = scryptSync(pin, salt, 32).toString('hex');
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO authorization(id,owner,value,salt,verifier,last_seen) VALUES(1,?,?,?,?,?)',
        )
        .run(owner, this.encode(grant), salt, verifier, this.clock());
      this.db.prepare('DELETE FROM stock').run();
      const insert = this.db.prepare('INSERT INTO stock VALUES(?,?)');
      for (const b of grant.batches) insert.run(b.id, b.quantity);
      this.db.prepare("INSERT INTO events(event,at) VALUES('provision',?)").run(this.clock());
    })();
    this.lock();
  }
  unlock(owner: string, pin: string) {
    const row = this.db.prepare('SELECT * FROM authorization WHERE owner=?').get(owner) as
      | {
          value: Buffer;
          salt: string;
          verifier: string;
          attempts: number;
          locked_until: number;
          last_seen: number;
        }
      | undefined;
    if (!row) throw new Error('Sign in online and prepare offline access on this terminal first');
    if (this.clock() < row.locked_until)
      throw new Error('Too many PIN attempts. Try again after 15 minutes');
    if (
      !/^\d{8,12}$/.test(pin) ||
      !timingSafeEqual(scryptSync(pin, row.salt, 32), Buffer.from(row.verifier, 'hex'))
    ) {
      this.db
        .prepare('UPDATE authorization SET attempts=attempts+1,locked_until=? WHERE id=1')
        .run(row.attempts >= 4 ? this.clock() + 900000 : 0);
      throw new Error('Offline PIN is incorrect');
    }
    const grant = this.decode<OfflineGrant>(row.value);
    if (this.clock() < row.last_seen - 60000)
      throw new Error('The device clock moved backwards. Sign in online to renew access');
    if (
      this.clock() > Date.parse(grant.expiresAt) ||
      this.clock() < Date.parse(grant.issuedAt) - 60000
    )
      throw new Error('Offline authorization expired. Sign in online to renew it');
    this.db
      .prepare('UPDATE authorization SET attempts=0,locked_until=0,last_seen=? WHERE id=1')
      .run(this.clock());
    this.grant = grant;
    return this.profile();
  }
  private current() {
    if (!this.grant) throw new Error('Unlock offline access first');
    const row = this.db.prepare('SELECT last_seen FROM authorization WHERE id=1').get() as {
      last_seen: number;
    };
    if (this.clock() > Date.parse(this.grant.expiresAt) || this.clock() < row.last_seen - 60000) {
      this.lock();
      throw new Error('Offline authorization expired or the clock changed. Sign in online');
    }
    this.db.prepare('UPDATE authorization SET last_seen=? WHERE id=1').run(this.clock());
    return this.grant;
  }
  private profile() {
    return { ...this.current().actor, permissions: ['catalog.read', 'sales.write'], offline: true };
  }
  private owner() {
    return (
      this.db.prepare('SELECT owner FROM authorization WHERE id=1').get() as { owner: string }
    ).owner;
  }
  private products() {
    const grant = this.current(),
      day = new Date(this.clock()).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
    return grant.products.map((p) => ({
      ...p,
      stock: grant.batches
        .filter(
          (b) => b.product_id === p.id && (!b.expiry_date || b.expiry_date.slice(0, 10) >= day),
        )
        .reduce(
          (sum, b) =>
            sum +
            (
              this.db.prepare('SELECT quantity FROM stock WHERE id=?').get(b.id) as {
                quantity: number;
              }
            ).quantity,
          0,
        ),
    }));
  }
  request(request: ApiRequest): unknown {
    const grant = this.current(),
      url = new URL(request.path, 'https://local.invalid'),
      path = url.pathname;
    if (request.method === 'POST' && path === '/sales') return this.sale(request.body);
    if (request.method !== 'GET') throw new Error('This action requires an online session');
    if (path === '/auth/me') return this.profile();
    if (path === '/categories') return grant.categories;
    if (path === '/settings')
      return { ...grant.shop, expiry_alert_days: 30, require_cash_session: !!grant.cashSessionId };
    if (path === '/customers' || path === '/sales/park') return [];
    if (path === '/products') {
      const search = (url.searchParams.get('search') ?? '').toLowerCase(),
        limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 25)),
        page = Math.max(1, Number(url.searchParams.get('page')) || 1);
      const items = this.products().filter((p) =>
        `${p.name} ${p.sku} ${p.barcode ?? ''}`.toLowerCase().includes(search),
      );
      return {
        items: items.slice((page - 1) * limit, page * limit),
        total: items.length,
        page,
        limit,
      };
    }
    if (path.startsWith('/products/'))
      return this.products().find((p) => p.id === path.split('/')[2]);
    if (path === '/sales') {
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 25));
      const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
      return this.db
        .prepare('SELECT value FROM receipts WHERE owner=? ORDER BY rowid DESC LIMIT ? OFFSET ?')
        .all(this.owner(), limit, (page - 1) * limit)
        .map((row) => this.decode((row as { value: Buffer }).value));
    }
    if (/^\/sales\/[a-f\d-]+(\/receipt)?$/.test(path)) {
      const row = this.db
        .prepare('SELECT value FROM receipts WHERE owner=? AND id=?')
        .get(this.owner(), path.split('/')[2]) as { value: Buffer } | undefined;
      if (!row) throw new Error('This receipt is not stored on this terminal');
      return this.decode(row.value);
    }
    throw new Error(
      'This screen requires an online session. Offline access supports the cached catalog, cash checkout and local receipts',
    );
  }
  private sale(input: unknown) {
    const grant = this.current(),
      sale = saleSchema.parse(input),
      owner = this.owner(),
      fingerprint = createHash('sha256').update(JSON.stringify(sale)).digest('hex');
    const prior = this.db
      .prepare('SELECT fingerprint,value FROM receipts WHERE id=? AND owner=?')
      .get(sale.operationId, owner) as { fingerprint: string; value: Buffer } | undefined;
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new Error('Receipt ID already belongs to another sale');
      return this.decode(prior.value);
    }
    if (
      sale.terminalId !== grant.terminalId ||
      sale.customerId ||
      sale.creditCustomer ||
      sale.schedule ||
      sale.parkedId ||
      sale.dueDate ||
      sale.payments.length !== 1 ||
      sale.payments[0]?.method !== 'cash' ||
      sale.lines.some((l) => l.discount !== 0) ||
      (sale.orderDiscount ?? 0) > 0 ||
      new Set(sale.lines.map((l) => l.productId)).size !== sale.lines.length
    )
      throw new Error('Offline sales support walk-in cash payments without discounts or credit');
    return this.db.transaction(() => {
      const createdAt = new Date(this.clock()).toISOString(),
        day = new Date(this.clock()).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }),
        allocations: OfflineOperation['allocations'] = [];
      let total = 0,
        tax = 0,
        subtotal = 0;
      const lines = sale.lines.map((l) => {
        const p = grant.products.find((p) => p.id === l.productId && p.active);
        if (!p) throw new Error('Product is not in the authorized catalog');
        let remaining = l.quantity;
        for (const b of grant.batches.filter(
          (b) => b.product_id === p.id && (!b.expiry_date || b.expiry_date.slice(0, 10) >= day),
        )) {
          if (!remaining) break;
          const stock = (
              this.db.prepare('SELECT quantity FROM stock WHERE id=?').get(b.id) as {
                quantity: number;
              }
            ).quantity,
            take = Math.min(remaining, stock);
          if (!take) continue;
          this.db.prepare('UPDATE stock SET quantity=quantity-? WHERE id=?').run(take, b.id);
          allocations.push({ batchId: b.id, productId: p.id, quantity: take });
          remaining -= take;
        }
        if (remaining) throw new Error(`Insufficient cached sellable stock for ${p.name}`);
        const amounts = lineTotals(p.selling_price, l.quantity, 0, p.tax_bps);
        total += amounts.total;
        tax += amounts.tax;
        subtotal += amounts.subtotal;
        return {
          id: p.id,
          product_id: p.id,
          name: p.name,
          quantity: l.quantity,
          unit_price: p.selling_price,
          ...amounts,
        };
      });
      const paid = sale.payments[0]!.amount,
        tendered = sale.cashTendered ?? paid;
      if (paid !== total || tendered < paid)
        throw new Error('Cash payment must equal the total and cash received must cover it');
      const receipt = {
        id: sale.operationId,
        invoice_number: `${grant.shop.invoice_prefix ?? 'AGR'}-${sale.operationId.toUpperCase()}`,
        created_at: createdAt,
        cashier: grant.actor.name,
        total,
        tax,
        subtotal,
        discount: 0,
        credit: 0,
        cash_tendered: tendered,
        change: tendered - paid,
        shop: grant.shop,
        lines,
        payments: sale.payments,
        status: 'completed',
        offline: true,
        customer: null,
      };
      const operation: OfflineOperation = {
        grantId: grant.id,
        grantToken: grant.token,
        sale,
        createdAt,
        allocations,
      };
      this.db
        .prepare('INSERT INTO receipts VALUES(?,?,?,?)')
        .run(sale.operationId, owner, fingerprint, this.encode(receipt));
      this.db
        .prepare("INSERT INTO queue(id,owner,payload,state) VALUES(?,?,?,'pending')")
        .run(sale.operationId, owner, this.encode(operation));
      this.db
        .prepare("INSERT INTO events(receipt_id,event,at) VALUES(?,'sale.committed',?)")
        .run(sale.operationId, this.clock());
      return receipt;
    })();
  }
  queued(owner: string, force = false) {
    return (
      this.db
        .prepare(
          "SELECT * FROM queue WHERE owner=? AND state IN ('pending','failed','conflict') AND (? OR next_attempt<=?) ORDER BY rowid LIMIT 100",
        )
        .all(owner, force ? 1 : 0, this.clock()) as QueueRow[]
    ).map((r) => ({ ...r, operation: this.decode<OfflineOperation>(r.payload) }));
  }
  begin(id: string) {
    this.db.prepare("UPDATE queue SET state='syncing',attempts=attempts+1 WHERE id=?").run(id);
  }
  settle(result: SyncResult) {
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE queue SET state=?,message=?,next_attempt=? WHERE id=?')
        .run(
          result.state,
          result.message ?? '',
          result.state === 'conflict' ? this.clock() + 300000 : 0,
          result.id,
        );
      this.db
        .prepare('INSERT INTO events(receipt_id,event,at) VALUES(?,?,?)')
        .run(result.id, `sync.${result.state}`, this.clock());
    })();
  }
  fail(id: string, message: string) {
    const row = this.db.prepare('SELECT attempts FROM queue WHERE id=?').get(id) as {
      attempts: number;
    };
    this.db
      .prepare("UPDATE queue SET state='failed',message=?,next_attempt=? WHERE id=?")
      .run(message, this.clock() + Math.min(300000, 1000 * 2 ** Math.min(8, row.attempts)), id);
  }
}
