import { spawnSync } from 'node:child_process';
import process from 'node:process';
import electron from 'electron';
const result = spawnSync(
  electron,
  [
    '-e',
    "const D=require('better-sqlite3');const db=new D(':memory:');console.log('Electron SQLite:',db.prepare('select sqlite_version() version').get().version);db.close()",
  ],
  { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
);
process.exitCode = result.status ?? 1;
