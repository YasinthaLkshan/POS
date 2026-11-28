import { app, safeStorage } from 'electron';
import { ApiSession } from './session';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { CheckoutJournal } from '../database/journal';

import {
  computerRoles,
  branches,
  connectionSchema,
  postgresUrl,
  type ApiRequest,
  type ApiResult,
  type BackupStatus,
} from '@agripos/shared';
import { imageId, imageFile, writeImage, readImage, validateImage } from './local-images';
import { validateApiUrl } from './api-url';
import { startEmbeddedApi, type EmbeddedApi } from './embedded-api';

let client: ApiSession | null = null;
let configuration: { apiUrl: string } | null = null;
let embedded: EmbeddedApi | null = null;
let starting: Promise<void> | null = null;
let journal: CheckoutJournal | null = null;
export function lockOffline() {}
export function offlineStatus() {
  const sync = embedded?.sync;
  const pending = sync?.pending ?? false;
  return {
    authorized: !!sync?.initialized,
    workOffline: sync?.offline ?? false,
    unlocked: false,
    expiresAt: null,
    staffName: null,
    lastSyncedAt: sync?.lastSyncedAt ? Date.parse(sync.lastSyncedAt) : null,
    counts: { pending: pending ? 1 : 0 },
    operations:
      pending || sync?.lastError
        ? [
            {
              id: 'shop',
              state: sync?.lastError?.startsWith('Changes exist') ? 'conflict' : 'pending',
              message: sync?.lastError ?? 'Shop changes awaiting cloud synchronization',
              attempts: 0,
            },
          ]
        : [],
  };
}
export async function prepareOffline(_pin: string) {
  return {
    error: {
      code: 'NOT_NEEDED',
      message: 'Use your normal username and password. Offline access is automatic.',
    },
  };
}
export async function unlockOffline(_pin: string) {
  return prepareOffline(_pin);
}
export async function syncNow(_force = true) {
  if (!embedded) return { data: false };
  if (embedded.sync.offline)
    return {
      error: {
        code: 'OFFLINE_MODE',
        message: 'Turn off Work offline to synchronize with the cloud.',
      },
    };
  await embedded.sync.sync();
  return embedded.sync.lastError
    ? { error: { code: 'SYNC_PENDING', message: embedded.sync.lastError } }
    : { data: offlineStatus() };
}
export async function setWorkOffline(enabled: boolean) {
  await ensureEmbeddedStarted();
  if (!embedded) throw new Error('Connect your shop once before working offline.');
  await embedded.sync.setOffline(enabled);
  return offlineStatus();
}
function checkoutJournal() {
  return (journal ??= new CheckoutJournal(join(app.getPath('userData'), 'checkout.sqlite')));
}
export function closeJournal() {
  journal?.close();
  journal = null;
}
export async function pendingSales() {
  const { data } = await auth().getSession();
  return data.session
    ? checkoutJournal().pending(`${ownerNamespace()}|${data.session.user.id}`)
    : [];
}
const configPath = () => join(app.getPath('userData'), 'neon-connection.bin');
const authPath = () => join(app.getPath('userData'), 'agripos-session.bin');
const storedSchema = z.object({
  databaseUrl: postgresUrl,
  branch: z.enum(branches).default('Kuruwita'),
  signingKey: z.string().min(32),
  role: z.enum(computerRoles).default('till'),
  backupUrl: postgresUrl.optional(),
});
function storedConfig() {
  if (!existsSync(configPath())) return null;
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('Windows secure credential storage is unavailable');
  return storedSchema.parse(JSON.parse(safeStorage.decryptString(readFileSync(configPath()))));
}
function ownerNamespace() {
  if (!app.isPackaged && process.env.AGRIPOS_TEST_USER_DATA && process.env.AGRIPOS_API_URL)
    return process.env.AGRIPOS_API_URL;
  const saved = storedConfig();
  return saved ? `neon:${createHash('sha256').update(saved.databaseUrl).digest('hex')}` : '';
}
export async function configure(input: unknown) {
  const config = connectionSchema.parse(input);
  if (client && (await client.getSession()).data.session)
    throw new Error('Sign out before changing connections');
  if (starting) await starting.catch(() => undefined);
  if (embedded?.sync.pending)
    throw new Error('Synchronize the saved shop changes before changing the cloud connection.');
  if (embedded) await embedded.stop();
  embedded = null;
  starting = null;
  configuration = null;
  client = null;
  const previous = storedConfig();
  const signingKey = previous?.signingKey ?? randomUUID() + randomUUID();
  const started = await startEmbeddedApi({
    databaseUrl: config.databaseUrl,
    branch: config.branch,
    signingKey,
    createDatabase: config.role === 'main',
    adminPassword: config.adminPassword,
    shopName: config.shopName,
    existingStaffId: config.existingStaffId,
  });
  try {
    writeFileSync(
      configPath(),
      safeStorage.encryptString(
        JSON.stringify({
          databaseUrl: config.databaseUrl,
    branch: config.branch,
          signingKey,
          role: config.role,
          backupUrl: config.backupUrl,
        }),
      ),
    );
  } catch (error) {
    await started.stop();
    throw error;
  }
  embedded = started;
  configuration = { apiUrl: started.apiUrl };
}
export function connection() {
  if (configuration) return configuration;
  if (!app.isPackaged && process.env.AGRIPOS_TEST_USER_DATA && process.env.AGRIPOS_API_URL) {
    validateApiUrl(process.env.AGRIPOS_API_URL);
    configuration = { apiUrl: process.env.AGRIPOS_API_URL };
  } else if (existsSync(configPath())) {
    configuration = { apiUrl: 'http://127.0.0.1:4000' };
  }
  return configuration;
}
export async function ensureEmbeddedStarted() {
  if (
    embedded ||
    (!app.isPackaged && process.env.AGRIPOS_TEST_USER_DATA && process.env.AGRIPOS_API_URL)
  )
    return;
  const saved = storedConfig();
  if (!saved) return;
  if (!starting) {
    starting = startEmbeddedApi({
      databaseUrl: saved.databaseUrl,
      branch: saved.branch,
      signingKey: saved.signingKey,
      createDatabase: saved.role === 'main',
    })
      .then((started) => {
        embedded = started;
        configuration = { apiUrl: started.apiUrl };
      })
      .catch((error: unknown) => {
        starting = null;
        throw error;
      });
  }
  await starting;
}
export async function stopEmbedded() {
  if (embedded) await embedded.stop();
  embedded = null;
}
export function auth() {
  if (client) return client;
  const config = connection();
  if (!config) throw new Error('Configure your shop connection first');
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('Windows secure credential storage is unavailable');
  client = new ApiSession(
    config.apiUrl.replace(/\/$/, ''),
    {
      read: () =>
        existsSync(authPath()) ? safeStorage.decryptString(readFileSync(authPath())) : null,
      write: (value) => writeFileSync(authPath(), safeStorage.encryptString(value)),
      clear: () => {
        if (existsSync(authPath())) unlinkSync(authPath());
      },
    },
    fetch,
  );
  return client;
}
export async function saveLocalImage(endpoint: string, bytes: Buffer) {
  const productId = imageId(endpoint);
  if (!productId) throw new Error('Invalid image endpoint');
  validateImage(bytes);
  const session = (await auth().getSession()).data.session;
  if (!session) throw new Error('Sign in before saving an image');
  const result = await onlineRequest({
    method: 'POST',
    path: endpoint,
    body: { png: bytes.toString('base64') },
  });
  if (result.error) throw new Error(result.error.message);
  const path = imageFile(app.getPath('userData'), ownerNamespace(), session.user.shopId, productId);
  writeImage(path, bytes);
}
export async function apiRequest<T = unknown>(request: ApiRequest): Promise<ApiResult<T>> {
  const localId = request.method === 'GET' ? imageId(request.path) : null;
  if (localId) {
    const stored = await onlineRequest<{ dataUrl: string | null }>(request);
    if (stored.error || stored.data?.dataUrl) return stored as ApiResult<T>;
    const session = (await auth().getSession()).data.session;
    if (!session) return { error: { code: 'UNAUTHORIZED', message: 'Sign in to view images' } };
    const path = imageFile(app.getPath('userData'), ownerNamespace(), session.user.shopId, localId);
    const localImage = readImage(path);
    const bundledLogo =
      localId === 'logo'
        ? app.isPackaged
          ? join(process.resourcesPath, 'branding', 'logo.jpeg')
          : join(app.getAppPath(), 'resources', 'logo.jpeg')
        : null;
    const dataUrl =
      localImage ??
      (bundledLogo && existsSync(bundledLogo)
        ? `data:image/jpeg;base64,${readFileSync(bundledLogo).toString('base64')}`
        : null);
    return { data: { dataUrl } as T };
  }
  return onlineRequest<T>(request);
}
async function onlineRequest<T = unknown>(request: ApiRequest): Promise<ApiResult<T>> {
  try {
    const config = connection();
    if (!config)
      return { error: { code: 'SETUP_REQUIRED', message: 'Configure your shop connection first' } };
    await ensureEmbeddedStarted();
    const { data, error } = await auth().getSession();
    if (error || !data.session)
      return { error: { code: 'UNAUTHORIZED', message: 'Sign in to continue' } };
    const owner = `${ownerNamespace()}|${data.session.user.id}`;
    const staged =
      request.method === 'POST' && request.path === '/sales'
        ? checkoutJournal().stage(owner, request.body)
        : null;
    const response = await fetch(`${config.apiUrl.replace(/\/$/, '')}/api/v1${request.path}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    const result = (await response.json()) as ApiResult<T>;
    if (staged) {
      if (response.ok && result.data)
        checkoutJournal().settle(owner, staged.operationId, 'accepted', result);
      else if (
        [400, 404, 409, 422].includes(response.status) &&
        result.error?.code !== 'IDEMPOTENCY_CONFLICT'
      )
        checkoutJournal().settle(owner, staged.operationId, 'rejected', result);
    }
    if (!response.ok && !result.error)
      return { error: { code: 'API_ERROR', message: `Service returned ${response.status}` } };
    return result;
  } catch (error) {
    return {
      error: {
        code: 'CONNECTION_ERROR',
        message: error instanceof Error ? error.message : 'Cannot reach the shop service',
      },
    };
  }
}
export function backupStatus(): BackupStatus {
  const sync = embedded?.sync;
  return {
    role: 'main',
    cloudConfigured: !!storedConfig(),
    toolsFound: true,
    running: sync?.running ?? false,
    lastLocalAt: null,
    lastCloudAt: sync?.lastSyncedAt ?? null,
    lastError: sync?.lastError ?? null,
  };
}
export async function backupNow(): Promise<ApiResult<BackupStatus>> {
  const result = await syncNow();
  return result.error ? { error: result.error } : { data: backupStatus() };
}
export function terminalId() {
  const path = join(app.getPath('userData'), 'terminal-id');
  if (existsSync(path)) return readFileSync(path, 'utf8');
  const id = randomUUID();
  writeFileSync(path, id);
  return id;
}
