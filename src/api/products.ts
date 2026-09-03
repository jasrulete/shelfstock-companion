import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Product, ProductsListResponse, StockAdjustment } from './types';

export interface ProductInput {
  name: string;
  description?: string | null;
  price: number;
  category: string;
  stock?: number;
  image_url?: string | null;
  barcode?: string | null;
}

export function useProducts(search: string) {
  return useQuery({
    queryKey: ['products', search],
    queryFn: () =>
      api<ProductsListResponse>(
        `/api/products?limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`
      ),
  });
}

export function useProduct(id: number) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: () => api<Product>(`/api/products/${id}`),
    enabled: Number.isFinite(id),
  });
}

export function lookupBarcode(code: string): Promise<Product> {
  return api<Product>(`/api/products/barcode/${encodeURIComponent(code)}`);
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) =>
      api<Product>('/api/products', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<ProductInput> & { id: number }) =>
      api<Product>(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product', id] });
    },
  });
}

interface AdjustStockInput {
  id: number;
  delta: number;
  note?: string;
}

interface AdjustStockResponse {
  stock: number;
  adjustment: StockAdjustment;
}

/**
 * Moves a product's stock by a delta through POST /adjust-stock, which the
 * server applies atomically while holding the row. The alternative - read the
 * count, add one, PUT it back - silently swallows any order that decremented
 * the same product between the read and the write, and that is a worse bug
 * than the ergonomics problem a stepper solves.
 *
 * Optimistic on every cached product list: the row moves the moment the
 * button is pressed, is put back if the server refuses, and settles on the
 * server's count either way.
 */
export function useAdjustStock() {
  const queryClient = useQueryClient();

  const patchLists = (id: number, update: (stock: number) => number) =>
    queryClient.setQueriesData<ProductsListResponse>({ queryKey: ['products'] }, (old) =>
      old
        ? {
            ...old,
            products: old.products.map((p) => (p.id === id ? { ...p, stock: update(p.stock) } : p)),
          }
        : old
    );

  return useMutation({
    mutationFn: ({ id, delta, note }: AdjustStockInput) =>
      api<AdjustStockResponse>(`/api/products/${id}/adjust-stock`, {
        method: 'POST',
        body: JSON.stringify({ delta, source: 'companion', ...(note ? { note } : {}) }),
      }),
    onMutate: async ({ id, delta }) => {
      // Stop an in-flight list refetch from landing on top of the optimistic
      // value with a stale count.
      await queryClient.cancelQueries({ queryKey: ['products'] });
      const previous = queryClient.getQueriesData<ProductsListResponse>({ queryKey: ['products'] });
      patchLists(id, (stock) => stock + delta);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSuccess: ({ stock }, { id }) => {
      // The server's number, not ours: a concurrent order may have moved it.
      patchLists(id, () => stock);
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product', id] });
    },
  });
}
