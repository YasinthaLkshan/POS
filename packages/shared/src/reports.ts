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
  'business-summary',
  'daily-sales',
  'cash-sales',
  'credit-sales',
  'mixed-sales',
  'repayments',
  'outstanding',
  'due-today',
  'overdue',
  'driver-credit',
  'normal-credit',
  'factory-credit',
  'discounts',
  'stock',
] as const;
export const reportLabels: Partial<Record<(typeof reportKinds)[number], string>> = {
  'business-summary': 'End-of-day business summary',
  'daily-sales': 'Daily sales',
  'cash-sales': 'Cash sales',
  'credit-sales': 'Credit sales',
  'mixed-sales': 'Mixed cash/credit sales',
  repayments: 'Credit repayments',
  outstanding: 'Outstanding credit',
  'due-today': 'Due today',
  overdue: 'Overdue credit',
  'driver-credit': 'Driver credit',
  'normal-credit': 'Normal customer credit',
  'factory-credit': 'Factory-wise driver credit',
  discounts: 'Discounts given',
  products: 'Product sales',
  stock: 'Stock availability',
  movements: 'Stock movement history',
  'low-stock': 'Low stock',
};
export type ReportKind = (typeof reportKinds)[number];
export interface Report {
  title: string;
  columns: { key: string; label: string; format?: 'money' | 'quantity' | 'date' }[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}
