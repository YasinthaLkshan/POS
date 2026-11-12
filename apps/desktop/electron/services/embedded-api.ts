import { app } from 'electron';
import { resolve, join } from 'node:path';
import type { Server } from 'node:http';
import { createApp } from '../../../api/src/app';
import { postgres, type Database } from '../../../api/src/database/db';
import { runMigrations } from '../../../api/src/database/migrate';
import { passwordAuthentication } from '../../../api/src/middleware/auth';
import { ensureAdministrator } from '../../../api/src/services/bootstrap';

export interface EmbeddedApi {
  apiUrl: string;
  stop(): Promise<void>;
}

function migrationDirectory() {
  return app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : resolve(app.getAppPath(), '../../supabase/migrations');
}

export async function startEmbeddedApi(input: {
  databaseUrl: string;
  signingKey: string;
  adminPassword?: string;
  shopName?: string;
  existingStaffId?: string;
}): Promise<EmbeddedApi> {
  const db: Database = postgres(input.databaseUrl);
  let server: Server | undefined;
  try {
    await db.query('SELECT 1');
    await runMigrations(db, migrationDirectory());
    await ensureAdministrator(db, {
      password: input.adminPassword,
      shopName: input.shopName,
      existingStaffId: input.existingStaffId,
    });
    process.env.OFFLINE_SIGNING_KEY = input.signingKey;
    server = createApp(db, passwordAuthentication(db)).listen(4000, '127.0.0.1');
    await new Promise<void>((done, fail) => {
      server!.once('listening', done);
      server!.once('error', fail);
    });
    const running = server;
    return {
      apiUrl: 'http://127.0.0.1:4000',
      async stop() {
        await new Promise<void>((done) => running.close(() => done()));
        await db.close();
      },
    };
  } catch (error) {
    if (server?.listening) await new Promise<void>((done) => server!.close(() => done()));
    await db.close();
    throw error;
  }
}
