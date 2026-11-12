import { app, safeStorage } from 'electron';
import { ApiSession } from './session';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { CheckoutJournal } from '../database/journal';
import { OfflineStore } from '../database/offline';
import type { OfflineGrant, SyncResult } from '@agripos/shared';
import {
  connectionSchema,
  type ApiRequest,
  type ApiResult,
} from '@agripos/shared';
import { imageId, imageFile, writeImage, readImage, validateImage } from './local-images';
import { validateApiUrl } from './api-url';
import { startEmbeddedApi, type EmbeddedApi } from './embedded-api';
let client: ApiSession | null = null;
let configuration: { apiUrl: string } | null = null;
let embedded: EmbeddedApi | null = null;
let starting: Promise<void> | null = null;
let journal: CheckoutJournal | null = null;
let offline: OfflineStore | null = null;
let syncing = false;
function offlineStore() {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('Windows secure storage is unavailable');
  return (offline ??= new OfflineStore(join(app.getPath('userData'), 'offline.sqlite'), {
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  }));
}
export function lockOffline() {
  offline?.lock();
}
export function offlineStatus() {
  const store = offlineStore(),
    owner = store.cachedOwner(ownerNamespace());
  return owner
    ? store.status(owner)
    : {
        authorized: false,
        unlocked: false,
        expiresAt: null,
        staffName: null,
        lastSyncedAt: null,
        counts: {},
        operations: [],
      };
}
export async function prepareOffline(pin: string) {
  if ((await pendingSales()).length)
    throw new Error('Resolve the pending online checkout before preparing offline access');
  const result = await onlineRequest<OfflineGrant>({
    method: 'POST',
    path: '/sync/provision',
    body: { terminalId: terminalId() },
  });
  if (result.error || !result.data) return result;
  const session = (await auth().getSession()).data.session;
  if (!session) throw new Error('Sign in before preparing offline access');
  offlineStore().provision(`${ownerNamespace()}|${session.user.id}`, result.data, pin);
  return { data: true };
}
export async function unlockOffline(pin: string) {
  const store = offlineStore(),
    owner = store.cachedOwner(ownerNamespace());
  if (!owner) throw new Error('Prepare offline access online first');
  if (checkoutJournal().pending(owner).length)
    throw new Error('Resolve the pending online checkout before switching offline');
  return { data: store.unlock(owner, pin) };
}
export async function syncNow(force = true) {
  if (syncing) return { data: false };
  syncing = true;
  try {
    const { data } = await auth().getSession();
    if (!data.session)
      return { error: { code: 'UNAUTHORIZED', message: 'Sign in online to synchronize receipts' } };
    const owner = `${ownerNamespace()}|${data.session.user.id}`,
      store = offlineStore();
    for (const row of store.queued(owner, force)) {
      store.begin(row.id);
      const result = await onlineRequest<SyncResult>({
        method: 'POST',
        path: '/sync/push',
        body: row.operation,
      });
      if (result.error || !result.data) {
        store.fail(row.id, result.error?.message ?? 'Synchronization failed');
        if (result.error?.code === 'CONNECTION_ERROR' || result.error?.code === 'UNAUTHORIZED')
          break;
      } else store.settle(result.data);
    }
    return { data: store.status(owner) };
  } finally {
    syncing = false;
  }
}
function checkoutJournal() {
  return (journal ??= new CheckoutJournal(join(app.getPath('userData'), 'checkout.sqlite')));
}
export function closeJournal() {
  offline?.close();
  offline = null;
  journal?.close();
  journal = null;
}
export async function pendingSales() {
  if (offline?.unlocked) return [];
  const { data } = await auth().getSession();
  return data.session
    ? checkoutJournal().pending(`${ownerNamespace()}|${data.session.user.id}`)
    : [];
}
const configPath = () => join(app.getPath('userData'), 'neon-connection.bin');
const authPath = () => join(app.getPath('userData'), 'agripos-session.bin');
const storedSchema = z.object({
  databaseUrl: connectionSchema.shape.databaseUrl,
  signingKey: z.string().min(32),
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
  if (client) throw new Error('Sign out and restart before changing connections');
  if (starting) await starting.catch(() => undefined);
  if (embedded) throw new Error('Restart AgriPOS before changing the database');
  const previous = storedConfig();
  const signingKey = previous?.signingKey ?? randomUUID() + randomUUID();
  const started = await startEmbeddedApi({
    ...config,
    signingKey,
  });
  try {
    writeFileSync(
      configPath(),
      safeStorage.encryptString(JSON.stringify({ databaseUrl: config.databaseUrl, signingKey })),
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
    starting = startEmbeddedApi(saved)
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
  const result = await onlineRequest({ method: 'POST', path: endpoint, body: { local: true } });
  if (result.error) throw new Error(result.error.message);
  const path = imageFile(app.getPath('userData'), ownerNamespace(), session.user.shopId, productId);
  writeImage(path, bytes);
}
export async function apiRequest<T = unknown>(request: ApiRequest): Promise<ApiResult<T>> {
  const localId = request.method === 'GET' ? imageId(request.path) : null;
  if (localId) {
    const session = (await auth().getSession()).data.session;
    if (!session) return { error: { code: 'UNAUTHORIZED', message: 'Sign in to view images' } };
    const path = imageFile(app.getPath('userData'), ownerNamespace(), session.user.shopId, localId);
    return { data: { dataUrl: readImage(path) } as T };
  }
  if (offline?.unlocked) {
    try {
      return { data: offline.request(request) as T };
    } catch (error) {
      return {
        error: {
          code: 'OFFLINE_ACTION',
          message: error instanceof Error ? error.message : 'Offline operation failed',
        },
      };
    }
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
export function terminalId() {
  const path = join(app.getPath('userData'), 'terminal-id');
  if (existsSync(path)) return readFileSync(path, 'utf8');
  const id = randomUUID();
  writeFileSync(path, id);
  return id;
}
