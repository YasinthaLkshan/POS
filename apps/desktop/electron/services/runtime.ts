import { app, screen, type BrowserWindow } from 'electron';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
const stateSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(1000).max(10000),
  height: z.number().int().min(700).max(10000),
  maximized: z.boolean(),
});
export function logEvent(event: string, details: Record<string, string | number | boolean> = {}) {
  try {
    const dir = join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'desktop.jsonl');
    if (existsSync(file) && statSync(file).size > 1000000) {
      writeFileSync(join(dir, 'desktop.previous.jsonl'), readFileSync(file));
      writeFileSync(file, '');
    }
    appendFileSync(
      file,
      JSON.stringify({ time: new Date().toISOString(), event, ...details }) + '\n',
    );
  } catch {
    /* A full disk must not prevent reporting the primary UI error. */
  }
}
export function windowState() {
  try {
    const path = join(app.getPath('userData'), 'window.json');
    if (!existsSync(path)) return;
    const state = stateSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    const visible = screen
      .getAllDisplays()
      .some(
        (d) =>
          state.x + state.width > d.workArea.x &&
          state.x < d.workArea.x + d.workArea.width &&
          state.y + 50 > d.workArea.y &&
          state.y < d.workArea.y + d.workArea.height,
      );
    if (visible) return state;
  } catch {
    logEvent('window.state.invalid');
  }
  return;
}
export function saveWindow(window: BrowserWindow) {
  try {
    writeFileSync(
      join(app.getPath('userData'), 'window.json'),
      JSON.stringify({ ...window.getNormalBounds(), maximized: window.isMaximized() }),
    );
  } catch {
    logEvent('window.state.save-failed');
  }
}
