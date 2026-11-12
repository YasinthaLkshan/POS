import { createApp } from './app';
import { postgres } from './database/db';
import { passwordAuthentication } from './middleware/auth';
import pino from 'pino';
const log = pino();
const url = process.env.DATABASE_URL;
if (!url) {
  log.error('Set DATABASE_URL in .env. See SETUP.md.');
  process.exitCode = 1;
} else {
  const db = postgres(url);
  const server = createApp(db, passwordAuthentication(db)).listen(
    Number(process.env.PORT ?? 4000),
    process.env.HOST ?? '127.0.0.1',
    () => log.info('AgriPOS API listening'),
  );
  const shutdown = () =>
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
