import { z } from 'zod';
import type { SaleInput } from './schemas';
export const postgresUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol);
  }, 'Enter a PostgreSQL connection URL');
export const computerRoles = ['main', 'till'] as const;
export type ComputerRole = (typeof computerRoles)[number];
export const connectionSchema = z
  .object({
    databaseUrl: postgresUrl,
    role: z.enum(computerRoles).default('till'),
    backupUrl: postgresUrl.optional(),
    adminPassword: z.string().min(12).max(256).optional(),
    shopName: z.string().trim().min(1).max(120).optional(),
    existingStaffId: z.uuid().optional(),
  })
  .strict()
  .refine((c) => !c.backupUrl || c.role === 'main', {
    message: 'Only the main shop computer copies backups to the cloud',
    path: ['backupUrl'],
  })
  .refine((c) => c.backupUrl !== c.databaseUrl, {
    message: 'The cloud backup must be a different database from the shop database',
    path: ['backupUrl'],
  });
export type ConnectionConfig = z.input<typeof connectionSchema>;
export interface BackupStatus {
  role: ComputerRole | null;
  cloudConfigured: boolean;
  toolsFound: boolean;
  running: boolean;
  lastLocalAt: string | null;
  lastCloudAt: string | null;
  lastError: string | null;
}
export const requestSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PATCH']),
    path: z
      .string()
      .max(500)
      .regex(
        /^\/(auth\/me|permissions|roles|products|product-families|driver-discounts|categories|suppliers|supplier-payments|customers|factories|drivers|credit|repayments|inventory|purchases|sales|expenses|cash-sessions|notifications|sync|dashboard|reports|settings|staff)(\/[a-zA-Z0-9-]+)*(\?[^#]*)?$/,
      ),
    body: z.unknown().optional(),
  })
  .strict();
export type ApiRequest = z.infer<typeof requestSchema>;
/** Report-shaped API documents that may be printed or saved as A4 PDF. */
export const printableDocument =
  /^\/(drivers\/[0-9a-f-]{36}\/statement|factories\/[0-9a-f-]{36}\/report|reports\/detail\/[a-z-]+\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2})$/;
export interface ApiResult<T = unknown> {
  data?: T;
  error?: { message: string; code: string };
}
export interface DesktopBridge {
  uploadShopLogo(): Promise<{ cancelled: boolean }>;
  uploadProductImage(productId: string): Promise<{ cancelled: boolean }>;
  printReport(options: {
    pdf?: boolean;
    kind: import('./reports').ReportKind;
    from: string;
    to: string;
  }): Promise<{ cancelled: boolean }>;
  offlineStatus(): Promise<{
    authorized: boolean;
    unlocked: boolean;
    expiresAt: string | null;
    staffName: string | null;
    lastSyncedAt: number | null;
    counts: Record<string, number>;
    operations: { id: string; state: string; message: string; attempts: number }[];
  }>;
  prepareOffline(pin: string): Promise<ApiResult>;
  unlockOffline(pin: string): Promise<ApiResult>;
  syncNow(): Promise<ApiResult>;
  pendingSales(): Promise<SaleInput[]>;
  info(): Promise<{
    version: string;
    platform: string;
    configured: boolean;
    terminalId: string;
    contextIsolated: boolean;
    sandboxed: boolean;
  }>;
  configure(config: ConnectionConfig): Promise<void>;
  backupStatus(): Promise<BackupStatus>;
  backupNow(): Promise<ApiResult<BackupStatus>>;
  login(credentials: { username: string; password: string }): Promise<ApiResult>;
  logout(): Promise<void>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<ApiResult>;
  request<T = unknown>(request: ApiRequest): Promise<ApiResult<T>>;
  printers(): Promise<{ name: string; displayName: string }[]>;
  printReceipt(options: {
    marginMm?: number;
    saleId: string;
    printer: string;
    paper: '58mm' | '80mm' | 'A4';
    pdf: boolean;
  }): Promise<{ cancelled: boolean }>;
  printPaymentReceipt(options: {
    paymentId: string;
    printer: string;
    paper: '58mm' | '80mm' | 'A4';
    pdf: boolean;
    marginMm?: number;
  }): Promise<{ cancelled: boolean }>;
  printDocument(options: { path: string; pdf?: boolean }): Promise<{ cancelled: boolean }>;
  printTest(options: {
    printer: string;
    paper: '58mm' | '80mm' | 'A4';
    marginMm: number;
    pdf: boolean;
  }): Promise<{ cancelled: boolean }>;
}
