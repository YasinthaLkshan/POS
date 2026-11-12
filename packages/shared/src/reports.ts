export const reportKinds = [
  'products',
  'categories',
  'employees',
  'inventory',
  'low-stock',
  'expiry',
  'purchases',
  'expenses',
  'customer-balances',
  'supplier-balances',
  'cash-closing',
  'returns',
  'movements',
  'audit',
] as const;
export type ReportKind = (typeof reportKinds)[number];
export interface Report {
  title: string;
  columns: { key: string; label: string; format?: 'money' | 'quantity' | 'date' }[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}
