import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Order, OrderDetail, OrderStatus, OrdersListResponse } from './types';

/**
 * The server serves the order lifecycle (ADR-0007): every order payload
 * carries `allowed_transitions`, and the phone renders exactly that.
 *
 * FALLBACK exists for one case - a server older than that decision, which
 * sends no such field - and the screen marks its output stale, so a button
 * drawn from it is visibly not one the server vouched for. It is the last
 * copy of the matrix in this repo, and it must never be consulted while the
 * server has answered: the previous copy drifted (it lacked
 * pending -> completed) and a green test held the drift in place.
 */
const FALLBACK: Record<OrderStatus, OrderStatus[]> = {
  pending: ['shipped', 'completed', 'cancelled'],
  shipped: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function transitionsFor(
  order: Pick<Order, 'status' | 'allowed_transitions'>
): { actions: OrderStatus[]; stale: boolean } {
  if (Array.isArray(order.allowed_transitions)) {
    return { actions: order.allowed_transitions, stale: false };
  }
  return { actions: FALLBACK[order.status] ?? [], stale: true };
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
    // `note` is what the pack screen's "Ship anyway" skipped; the server logs
    // it and never stores it.
    mutationFn: ({ id, status, note }: { id: number; status: OrderStatus; note?: string }) =>
      api<Order>(`/api/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(note ? { note } : {}) }),
      }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', id] });
    },
  });
}
