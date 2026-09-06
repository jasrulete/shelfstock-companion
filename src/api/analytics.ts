import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface LowStockRow {
  id: number;
  name: string;
  stock: number;
}

/**
 * GET /api/analytics/low-stock (admin): products at or under the server's
 * threshold (5 by default), lowest first, at most 20. Not the storefront's
 * public /api/products/low-stock, which is a merchandising rail.
 */
export function fetchLowStock(): Promise<LowStockRow[]> {
  return api<LowStockRow[]>('/api/analytics/low-stock');
}

export function useLowStock() {
  return useQuery({ queryKey: ['low-stock'], queryFn: fetchLowStock });
}
