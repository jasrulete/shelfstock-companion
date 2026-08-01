import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Order, OrderDetail, OrderStatus, OrdersListResponse } from './types';

// Client-side mirror of the backend lifecycle (cancelled is terminal
// server-side; completed is left terminal here to keep the UI honest).
export function statusActions(status: OrderStatus): OrderStatus[] {
  switch (status) {
    case 'pending':
      return ['shipped', 'cancelled'];
    case 'shipped':
      return ['completed', 'cancelled'];
    default:
      return [];
  }
}

export function useOrders(status?: OrderStatus) {
  return useQuery({
    queryKey: ['orders', status ?? 'all'],
    queryFn: () =>
      api<OrdersListResponse>(`/api/orders?limit=50${status ? `&status=${status}` : ''}`),
  });
}

export function useOrder(id: number) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api<OrderDetail>(`/api/orders/${id}`),
    enabled: Number.isFinite(id),
  });
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: OrderStatus }) =>
      api<Order>(`/api/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', id] });
    },
  });
}
