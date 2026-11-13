import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ApiRequest } from '@agripos/shared';
export async function api<T>(
  path: string,
  method: ApiRequest['method'] = 'GET',
  body?: unknown,
): Promise<T> {
  const result = await window.desktop.request<T>({ path, method, body });
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
export function useData<T>(path: string, enabled = true) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => api<T>(path),
    enabled,
    retry: 1,
    refetchInterval: 30000,
  });
}
export function usePagedData<T>(path: string) {
  const [recordPage, setRecordPage] = useState(1);
  const result = useData<T[]>(
    `${path}${path.includes('?') ? '&' : '?'}limit=100&page=${recordPage}`,
  );
  return { ...result, recordPage, setRecordPage };
}
export function useAllOptions<T>(path: string, enabled = true) {
  return useQuery({
    queryKey: ['options', path],
    enabled,
    staleTime: 30000,
    queryFn: async () => {
      const rows: T[] = [];
      for (let page = 1; page <= 500; page++) {
        const result = await api<T[] | { items: T[]; total: number }>(
          `${path}?limit=100&page=${page}`,
        );
        const items = Array.isArray(result) ? result : result.items;
        rows.push(...items);
        if (items.length < 100 || (!Array.isArray(result) && rows.length >= result.total))
          return rows;
      }
      throw new Error(
        'This selection exceeds 50,000 records. Contact your administrator to narrow the catalog.',
      );
    },
  });
}
export function useAction<T = unknown>(path: string, method: ApiRequest['method'] = 'POST') {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api<T>(path, method, body),
    onSuccess: () => {
      void client.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
export function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
export interface Factory {
  id: string;
  name: string;
  address: string;
  phone: string;
  notes: string;
  active: boolean;
  drivers?: number;
  outstanding?: number;
  overdue?: number;
}
export interface Driver {
  id: string;
  name: string;
  driver_code: string;
  lorry_number: string;
  phone: string;
  address: string;
  notes: string;
  active: boolean;
  registered_at: string;
  factory_id: string;
  factory: string;
  outstanding: number;
  overdue: number;
  next_due: string | null;
}
export interface InstallmentRow {
  id: string;
  sale_id: string;
  seq: number;
  installment_count: number;
  due_date: string;
  amount: number;
  paid: number;
  reduced: number;
  remaining: number;
  invoice_number: string;
  sale_date: string;
  original_credit: number;
  customer_id: string;
  customer_name: string;
  customer_kind: 'registered' | 'driver' | 'walk_in';
  phone: string;
  driver_code: string | null;
  lorry_number: string;
  factory_id: string | null;
  factory: string | null;
  days: number;
  status: 'overdue' | 'due_today' | 'due_soon' | 'upcoming' | 'paid';
}
export interface CreditProfileData {
  customer: {
    id: string;
    name: string;
    kind: 'registered' | 'driver' | 'walk_in';
    phone: string;
    address: string;
    notes: string;
    driver_code: string | null;
    lorry_number: string;
    factory_id: string | null;
    factory: string | null;
    factory_phone: string | null;
    active: boolean;
    registered_at: string;
    outstanding: number;
    overdue: number;
    next_due: string | null;
  };
  totals: Record<string, number>;
  installments: InstallmentRow[];
  monthly: { month: string; amount: number; installments: number }[];
  invoices: {
    id: string;
    invoice_number: string;
    created_at: string;
    subtotal: number;
    discount: number;
    total: number;
    credit: number;
    paid_at_sale: number;
    outstanding: number;
    payment_type: 'cash' | 'credit' | 'mixed';
    status: string;
  }[];
  payments: {
    id: string;
    created_at: string;
    amount: number;
    method: string;
    notes: string;
    invoices: string | null;
  }[];
}
export type BusinessSummary = Record<string, number>;
export interface ShopSettings {
  name: string;
  driver_installments: number;
  driver_credit_months: number;
  normal_credit_months: number;
  due_soon_days: number;
  next_invoice_number: number;
  invoice_prefix: string;
}
export const printOptions = () => ({
  printer: localStorage.getItem('agripos-printer') ?? '',
  paper: (localStorage.getItem('agripos-paper') ?? '80mm') as '58mm' | '80mm' | 'A4',
  marginMm: Number(localStorage.getItem('agripos-margin') ?? 4),
});
export interface Product {
  id: string;
  name: string;
  family_id: string | null;
  family: string | null;
  variant_label: string;
  whole_units: boolean;
  driver_discount: number;
  sku: string;
  barcode: string | null;
  category_id: string;
  category: string;
  kind: string;
  supplier_id: string | null;
  selling_price: number;
  purchase_price?: number;
  tax_bps: number;
  minimum_stock: number;
  stock: number;
  unit: string;
  purchase_unit: string;
  purchase_factor: number;
  reorder_quantity: number;
  subcategory: string;
  image_path: string | null;
  active: boolean;
  brand: string;
  description: string;
  attributes: Record<string, string>;
}
export interface Contact {
  active: boolean;
  credit_enabled?: boolean;
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  credit_limit?: number;
  balance?: number;
}
export interface Category {
  id: string;
  name: string;
  kind: string;
}
export interface Batch {
  id: string;
  name: string;
  batch_number: string;
  expiry_date: string | null;
  quantity: number;
  unit_cost?: number;
  unit: string;
}
export interface Sale {
  id: string;
  invoice_number?: string;
  customer_name?: string;
  total: number;
  status: string;
  credit: number;
  created_at: string;
}
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const displayDate = (value: string) =>
  new Date(value).toLocaleDateString('en-LK', { timeZone: 'Asia/Colombo' });
