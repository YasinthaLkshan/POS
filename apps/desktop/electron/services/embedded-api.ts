import { app } from 'electron';
import { resolve, join } from 'node:path';
import type { Server } from 'node:http';
import { createApp } from '../../../api/src/app';
import { postgres } from '../../../api/src/database/db';
import { LocalDatabase } from '../../../api/src/database/sqlite';
import { CloudSync } from './cloud-sync';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import Sqlite from 'better-sqlite3';
import { runMigrations } from '../../../api/src/database/migrate';
import { passwordAuthentication } from '../../../api/src/middleware/auth';
import { ensureAdministrator } from '../../../api/src/services/bootstrap';

export interface EmbeddedApi {
  apiUrl: string;
  sync: CloudSync;
  stop(): Promise<void>;
}

function migrationDirectory() {
  return app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : resolve(app.getAppPath(), '../../migrations');
}

export async function startEmbeddedApi(input: {
  databaseUrl: string;
  signingKey: string;
  createDatabase?: boolean;
  adminPassword?: string;
  shopName?: string;
  existingStaffId?: string;
}): Promise<EmbeddedApi> {
  const identity = new URL(input.databaseUrl);
  const name = createHash('sha256')
    .update(identity.hostname + identity.pathname)
    .digest('hex')
    .slice(0, 20);
  const db = new LocalDatabase(join(app.getPath('userData'), `shop-${name}.sqlite`));
  const cloud = postgres(input.databaseUrl, 3000);
  const sync = new CloudSync(db, cloud);
  let server: Server | undefined;
  try {
    if (!sync.initialized) {
      const legacyPath = join(app.getPath('userData'), 'offline.sqlite');
      if (existsSync(legacyPath)) {
        const legacy = new Sqlite(legacyPath, { readonly: true });
        try {
          const pending = legacy
            .prepare("SELECT COUNT(*) count FROM queue WHERE state<>'synced'")
            .get() as { count: number };
          if (pending.count)
            throw new Error(
              'Receipts from the previous offline mode are still pending. Synchronize them in AgriPOS 0.6 before upgrading; their files have been kept.',
            );
        } finally {
          legacy.close();
        }
      }
      await runMigrations(cloud, migrationDirectory());
      await ensureAdministrator(cloud, {
        password: input.adminPassword,
        shopName: input.shopName,
        existingStaffId: input.existingStaffId,
      });
      await sync.sync();
    } else void sync.sync().catch(() => undefined);
    process.env.OFFLINE_SIGNING_KEY = input.signingKey;
    server = createApp(db, passwordAuthentication(db)).listen(4000, '127.0.0.1');
    await new Promise<void>((done, fail) => {
      server!.once('listening', done);
      server!.once('error', fail);
    });
    const running = server;
    return {
      apiUrl: 'http://127.0.0.1:4000',
      sync,
      async stop() {
        await new Promise<void>((done) => running.close(() => done()));
        await sync.close();
        await db.close();
      },
    };
  } catch (error) {
    if (server?.listening) await new Promise<void>((done) => server!.close(() => done()));
    await db.close();
    await cloud.close();
    throw error;
  }
}
