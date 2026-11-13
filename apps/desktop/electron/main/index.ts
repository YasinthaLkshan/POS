import { app, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { requestSchema, id, reportKinds, date, printableDocument } from '@agripos/shared';
import {
  connection,
  configure,
  auth,
  apiRequest,
  terminalId,
  pendingSales,
  closeJournal,
  prepareOffline,
  unlockOffline,
  offlineStatus,
  syncNow,
  lockOffline,
  saveLocalImage,
  ensureEmbeddedStarted,
  stopEmbedded,
  backupStatus,
  backupNow,
} from '../services/client';
import { printPaymentReceipt, printReceipt } from '../printing/receipt';
import { printDocument, printReport } from '../printing/report';
import { windowState, saveWindow, logEvent } from '../services/runtime';
let window: BrowserWindow | null = null;
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
if (!app.isPackaged && process.env.AGRIPOS_TEST_USER_DATA)
  app.setPath('userData', process.env.AGRIPOS_TEST_USER_DATA);
app.whenReady().then(() => {
  void ensureEmbeddedStarted().catch((error: unknown) =>
    logEvent('database.start.failure', { error: error instanceof Error ? error.name : 'Unknown' }),
  );
  const saved = windowState();
  logEvent('app.start', { version: app.getVersion(), packaged: app.isPackaged });
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    ...(saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : {}),
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#F2F6F3',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (saved?.maximized) window.maximize();
  window.on('close', () => {
    if (window) saveWindow(window);
  });
  window.webContents.on('render-process-gone', (_event, details) =>
    logEvent('renderer.gone', { reason: details.reason, exitCode: details.exitCode }),
  );
  window.on('unresponsive', () => logEvent('window.unresponsive'));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  const handle = (channel: string, handler: (input: unknown) => unknown) =>
    ipcMain.handle(channel, (event, input: unknown) => {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error('Untrusted sender');
      const frameUrl = event.senderFrame.url;
      const expected =
        !app.isPackaged && process.env.ELECTRON_RENDERER_URL
          ? process.env.ELECTRON_RENDERER_URL
          : pathToFileURL(join(__dirname, '../renderer/index.html')).href;
      if (
        frameUrl.split('#')[0] !== expected.split('#')[0] &&
        frameUrl.split('#')[0] !== `${expected}/`
      )
        throw new Error('Untrusted document');
      return Promise.resolve()
        .then(() => handler(input))
        .catch((error) => {
          logEvent('ipc.failure', {
            channel,
            error: error instanceof Error ? error.name : 'Unknown',
          });
          throw error;
        });
    });
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    configured: !!connection(),
    terminalId: terminalId(),
  }));
  handle('connection:configure', (input) => configure(input));
  handle('checkout:pending', () => pendingSales());
  const uploadImage = async (endpoint: string) => {
    const selection = await dialog.showOpenDialog(window!, {
      properties: ['openFile'],
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    const file = selection.filePaths[0];
    if (selection.canceled || !file) return { cancelled: true };
    if ((await stat(file)).size > 10000000) throw new Error('Choose an image smaller than 10 MB');
    const original = nativeImage.createFromBuffer(await readFile(file));
    if (original.isEmpty()) throw new Error('Image format could not be decoded');
    const dimensions = original.getSize(),
      resize = (size: number) =>
        original
          .resize({
            ...(dimensions.width >= dimensions.height ? { width: size } : { height: size }),
            quality: 'good',
          })
          .toPNG();
    let size = Math.min(512, Math.max(dimensions.width, dimensions.height)),
      bytes = resize(size);
    while (bytes.length > 131072 && size > 64) {
      size = Math.floor(size * 0.75);
      bytes = resize(size);
    }
    await saveLocalImage(endpoint, bytes);
    return { cancelled: false };
  };
  handle('product:image', (input) => uploadImage(`/products/${id.parse(input)}/image`));
  handle('shop:logo', () => uploadImage('/settings/logo'));
  handle('offline:status', () => offlineStatus());
  handle('offline:prepare', (input) =>
    prepareOffline(
      z
        .string()
        .regex(/^\d{8,12}$/)
        .parse(input),
    ),
  );
  handle('offline:unlock', (input) =>
    unlockOffline(
      z
        .string()
        .regex(/^\d{8,12}$/)
        .parse(input),
    ),
  );
  handle('offline:sync', () => syncNow());
  const syncTimer = setInterval(() => {
    void syncNow(false).catch((error) =>
      console.error(
        'Background sync failed:',
        error instanceof Error ? error.message : 'Unknown error',
      ),
    );
  }, 30000);
  syncTimer.unref();
  handle('backup:status', () => backupStatus());
  handle('backup:run', () => backupNow());
  const scheduledBackup = () => {
    try {
      if (backupStatus().role === 'main') void backupNow();
    } catch (error) {
      logEvent('backup.schedule.failure', {
        error: error instanceof Error ? error.name : 'Unknown',
      });
    }
  };
  setTimeout(scheduledBackup, 2 * 60000).unref();
  setInterval(scheduledBackup, 30 * 60000).unref();
  handle('auth:login', async (input) => {
    if (!connection())
      return {
        error: {
          code: 'SETUP_REQUIRED',
          message: 'Click Connect your shop and enter your Neon database URL first',
        },
      };
    try {
      await ensureEmbeddedStarted();
    } catch (error) {
      return {
        error: {
          code: 'SETUP_REQUIRED',
          message: error instanceof Error ? error.message : 'Could not start the shop database',
        },
      };
    }
    const p = z
      .object({ username: z.string().min(3).max(40), password: z.string().min(1).max(256) })
      .strict()
      .parse(input);
    const { error } = await auth().signInWithPassword(p);
    if (!error) lockOffline();
    return error ? { error: { code: 'LOGIN_FAILED', message: error.message } } : { data: true };
  });
  handle('auth:logout', async () => {
    lockOffline();
    await auth().signOut();
  });
  handle('auth:password', async (input) => {
    const p = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(256) })
      .strict()
      .parse(input);
    const { error } = await auth().updateUser(p);
    return error ? { error: { code: 'PASSWORD_FAILED', message: error.message } } : { data: true };
  });
  handle('api:request', (input) => {
    const p = requestSchema.parse(input);
    if (JSON.stringify(p).length > 262144) throw new Error('Request too large');
    return apiRequest(p);
  });
  handle('printer:list', async () =>
    (await window!.webContents.getPrintersAsync()).map((p) => ({
      name: p.name,
      displayName: p.displayName,
    })),
  );
  handle('printer:report', (input) =>
    printReport(
      window!,
      z
        .object({ kind: z.enum(reportKinds), from: date, to: date, pdf: z.boolean().default(true) })
        .strict()
        .parse(input),
    ),
  );
  handle('printer:receipt', (input) =>
    printReceipt(
      window!,
      z
        .object({
          saleId: id,
          printer: z.string().max(200),
          paper: z.enum(['58mm', '80mm', 'A4']),
          pdf: z.boolean(),
          marginMm: z.number().min(0).max(10).default(4),
        })
        .strict()
        .parse(input),
    ),
  );
  handle('printer:payment', (input) =>
    printPaymentReceipt(
      window!,
      z
        .object({
          paymentId: id,
          printer: z.string().max(200),
          paper: z.enum(['58mm', '80mm', 'A4']),
          pdf: z.boolean(),
          marginMm: z.number().min(0).max(10).default(4),
        })
        .strict()
        .parse(input),
    ),
  );
  handle('printer:document', (input) =>
    printDocument(
      window!,
      z
        .object({ path: z.string().regex(printableDocument), pdf: z.boolean().default(true) })
        .strict()
        .parse(input),
    ),
  );
  window.once('ready-to-show', () => window?.show());
  handle('printer:test', (input) =>
    printReceipt(
      window!,
      {
        ...z
          .object({
            printer: z.string().max(200),
            paper: z.enum(['58mm', '80mm', 'A4']),
            marginMm: z.number().min(0).max(10),
            pdf: z.boolean(),
          })
          .strict()
          .parse(input),
        saleId: 'TEST-PRINT',
      },
      true,
    ),
  );
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  closeJournal();
  void stopEmbedded();
});
