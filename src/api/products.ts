import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Product, ProductsListResponse } from './types';

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
