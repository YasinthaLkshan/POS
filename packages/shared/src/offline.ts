import { z } from 'zod';
import { id, saleSchema } from './schemas';
import type { Actor } from './permissions';
export interface OfflineProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category_id: string;
  category: string;
  kind: string;
  unit: string;
  selling_price: number;
  tax_bps: number;
  minimum_stock: number;
  active: boolean;
  stock: number;
  brand: string;
  description: string;
  attributes: Record<string, string>;
}
export interface OfflineBatch {
  id: string;
  product_id: string;
  quantity: number;
  expiry_date: string | null;
}
export interface OfflineGrant {
  id: string;
  token: string;
  actor: Actor;
  terminalId: string;
  expiresAt: string;
  issuedAt: string;
  products: OfflineProduct[];
  batches: OfflineBatch[];
  categories: { id: string; name: string; kind: string }[];
  shop: {
    name: string;
    address: string;
    phone: string;
    receipt_footer: string;
    invoice_prefix?: string;
  };
  cashSessionId: string | null;
}
export const offlineOperationSchema = z
  .object({
    grantId: id,
    grantToken: z.string().max(200),
    sale: saleSchema,
    createdAt: z.iso.datetime(),
    allocations: z
      .array(z.object({ batchId: id, productId: id, quantity: z.number().int().positive() }))
      .max(500),
  })
  .strict();
export type OfflineOperation = z.infer<typeof offlineOperationSchema>;
export interface SyncResult {
  id: string;
  state: 'synced' | 'conflict';
  message?: string;
  receipt?: unknown;
}
