import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { safeStorage } from 'electron';
import { saleSchema, type SaleInput } from '@agripos/shared';
/** Durable journal for uncertain ONLINE requests. This is not an offline sale authorization. */
export class CheckoutJournal {
  private db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,payload BLOB NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),result BLOB,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS submission_events(id INTEGER PRIMARY KEY,submission_id TEXT NOT NULL REFERENCES submissions(id),status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  }
  stage(owner: string, input: unknown) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable');
    const payload = saleSchema.parse(input),
      json = JSON.stringify(payload),
      fingerprint = createHash('sha256').update(json).digest('hex');
    this.db.transaction(() => {
      const prior = this.db
        .prepare('SELECT owner,fingerprint FROM submissions WHERE id=?')
        .get(payload.operationId) as { owner: string; fingerprint: string } | undefined;
      if (prior) {
        if (prior.owner !== owner || prior.fingerprint !== fingerprint)
          throw new Error('A different transaction already uses this operation ID');
        return;
      }
      this.db
        .prepare(
          "INSERT INTO submissions(id,owner,payload,fingerprint,status) VALUES(?,?,?,?,'pending')",
        )
        .run(payload.operationId, owner, safeStorage.encryptString(json), fingerprint);
      this.db
        .prepare("INSERT INTO submission_events(submission_id,status) VALUES(?,'pending')")
        .run(payload.operationId);
    })();
    return payload;
  }
  settle(owner: string, id: string, status: 'accepted' | 'rejected', result: unknown) {
    this.db.transaction(() => {
      const changed = this.db
        .prepare(
          "UPDATE submissions SET status=?,result=?,updated_at=CURRENT_TIMESTAMP WHERE owner=? AND id=? AND status='pending'",
        )
        .run(status, safeStorage.encryptString(JSON.stringify(result)), owner, id);
      if (changed.changes)
        this.db
          .prepare('INSERT INTO submission_events(submission_id,status) VALUES(?,?)')
          .run(id, status);
    })();
  }
  pending(owner: string): SaleInput[] {
    const rows = this.db
      .prepare(
        "SELECT payload FROM submissions WHERE owner=? AND status='pending' ORDER BY created_at,id",
      )
      .all(owner) as { payload: Buffer }[];
    return rows.map((r) => saleSchema.parse(JSON.parse(safeStorage.decryptString(r.payload))));
  }
  close() {
    this.db.close();
  }
}
