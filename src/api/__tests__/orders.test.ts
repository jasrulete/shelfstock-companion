import { transitionsFor } from '../orders';
import type { Order } from '../types';

const order = (over: Partial<Order>): Order => ({
  id: 1,
  user_id: 1,
  total_amount: '1.00',
  currency: 'USD',
  status: 'pending',
  payment_method: 'cod',
  shipping_name: null,
  shipping_phone: null,
  shipping_address: null,
  shipping_city: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

/**
 * ADR-0007. This file used to assert a local copy of the order lifecycle -
 * a copy that had drifted from the server's, so a green test was pinning the
 * bug in place. Now the server sends `allowed_transitions`, and the only thing
 * to test on the phone is that it renders exactly that, and is honest when
 * it has nothing from the server to render.
 */
describe('transitionsFor', () => {
  it('renders exactly what the server allows, and marks it fresh', () => {
    const t = transitionsFor(
      order({ status: 'pending', allowed_transitions: ['shipped', 'completed', 'cancelled'] })
    );
    expect(t).toEqual({ actions: ['shipped', 'completed', 'cancelled'], stale: false });
  });

  it('trusts an empty server list over any local idea of the lifecycle', () => {
    expect(transitionsFor(order({ status: 'pending', allowed_transitions: [] }))).toEqual({
      actions: [],
      stale: false,
    });
  });

  it('falls back only when the server sent nothing, and says so', () => {
    const t = transitionsFor(order({ status: 'pending' }));
    expect(t.stale).toBe(true);
    // The fallback is the server's matrix as last recorded - including the
    // same-day COD edge the old copy lacked.
    expect(t.actions).toEqual(['shipped', 'completed', 'cancelled']);
  });

  it('fallback: terminal statuses offer nothing', () => {
    expect(transitionsFor(order({ status: 'completed' }))).toEqual({ actions: [], stale: true });
    expect(transitionsFor(order({ status: 'cancelled' }))).toEqual({ actions: [], stale: true });
  });
});
