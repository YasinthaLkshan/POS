import { createServer } from 'electron-vite';
import process from 'node:process';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
// Only public desktop settings cross into Electron; backend credentials stay in the API.
if (existsSync('.env')) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync('.env', 'utf8')))) {
    if (key.startsWith('AGRIPOS_') && process.env[key] === undefined) process.env[key] = value;
  }
}
delete process.env.ELECTRON_RUN_AS_NODE;
process.chdir(resolve('apps/desktop'));
await createServer();
