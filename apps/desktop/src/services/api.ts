import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
export interface Product {
  id: string;
  name: string;
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
