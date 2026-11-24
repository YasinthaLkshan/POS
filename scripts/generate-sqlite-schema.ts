/** Build-time only: derive the SQLite schema from the existing PostgreSQL migrations. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const pg = new PGlite();
for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
  await pg.exec(await readFile(`migrations/${file}`, 'utf8'));
const tables = (
  await pg.query<{ name: string }>(
    "SELECT tablename name FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  )
).rows;
const schema = [];
for (const { name } of tables) {
  const columns = (
    await pg.query<{ name: string; type: string; nullable: boolean; default: string | null }>(
      `SELECT column_name name,udt_name type,is_nullable='YES' nullable,column_default AS default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
      [name],
    )
  ).rows;
  const constraints = (
    await pg.query<{ kind: string; sql: string }>(
      `SELECT contype kind,pg_get_constraintdef(oid) sql FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY conname`,
      [name],
    )
  ).rows;
  const indexes = (
    await pg.query<{ sql: string }>(
      `SELECT indexdef sql FROM pg_indexes WHERE schemaname='public' AND tablename=$1 AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE conrelid=$1::regclass)`,
      [name],
    )
  ).rows;
  schema.push({ name, columns, constraints, indexes });
}
await writeFile('apps/api/src/database/sqlite-schema.json', JSON.stringify(schema, null, 2) + '\n');
await pg.close();
