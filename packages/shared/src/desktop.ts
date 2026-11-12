import { z } from 'zod';
import type { SaleInput } from './schemas';
export const connectionSchema = z
  .object({
    databaseUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return ['postgres:', 'postgresql:'].includes(url.protocol);
      }, 'Enter a PostgreSQL connection URL'),
    adminPassword: z.string().min(12).max(256).optional(),
    shopName: z.string().trim().min(1).max(120).optional(),
    existingStaffId: z.uuid().optional(),
  })
  .strict();
export type ConnectionConfig = z.infer<typeof connectionSchema>;
export const requestSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PATCH']),
    path: z
      .string()
      .max(500)
      .regex(
        /^\/(auth\/me|permissions|roles|products|categories|suppliers|supplier-payments|customers|inventory|purchases|sales|expenses|cash-sessions|notifications|sync|dashboard|reports|settings|staff)(\/[a-zA-Z0-9-]+)*(\?[^#]*)?$/,
      ),
    body: z.unknown().optional(),
  })
  .strict();
export type ApiRequest = z.infer<typeof requestSchema>;
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
  printTest(options: {
    printer: string;
    paper: '58mm' | '80mm' | 'A4';
    marginMm: number;
    pdf: boolean;
  }): Promise<{ cancelled: boolean }>;
}
