import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { AuthProvider } from '../../../auth/AuthContext';
import OrderDetailScreen from '../[id]';

const mockStore: Record<string, string> = {
  shelfstock_jwt: 'token',
  shelfstock_user: JSON.stringify({ id: 1, email: 'admin@shelfstock.demo', role: 'admin' }),
};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(mockStore[k] ?? null)),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '5' }),
  Stack: { Screen: () => null },
  Redirect: () => null,
  router: { push: jest.fn(), replace: jest.fn() },
}));

const fetchMock = jest.fn();
// @ts-expect-error global.fetch is assigned during tests
global.fetch = fetchMock as unknown as typeof fetch;

function detail(over: Record<string, unknown>) {
  return {
    id: 5,
    user_id: 2,
    total_amount: '10.00',
    currency: 'USD',
    status: 'pending',
    payment_method: 'cod',
    shipping_name: 'A Customer',
    shipping_phone: '+63 900 000 0000',
    shipping_address: '1 Street',
    shipping_city: 'Cebu',
    created_at: '2026-01-01T00:00:00Z',
    items: [{ id: 1, order_id: 5, product_id: 6, quantity: 1, price_at_purchase: '10.00', product_name: 'Mug' }],
    ...over,
  };
}

function serve(body: unknown) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

async function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <OrderDetailScreen />
      </AuthProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
});

/**
 * ADR-0007: the buttons on this screen are whatever the server said is
 * allowed - nothing more, nothing less, and nothing decided locally.
 */
describe('order detail actions', () => {
  it('draws its buttons from allowed_transitions, including same-day completion', async () => {
    serve(detail({ allowed_transitions: ['shipped', 'completed', 'cancelled'] }));

    await renderDetail();

    await screen.findByText('Mark completed');
    expect(screen.getByText('Mark shipped')).toBeTruthy();
    expect(screen.getByText('Cancel order')).toBeTruthy();
    expect(screen.queryByText(/out of date/)).toBeNull();
  });

  it('offers only what the server listed, even when a local guess would offer more', async () => {
    serve(detail({ status: 'pending', allowed_transitions: ['cancelled'] }));

    await renderDetail();

    await screen.findByText('Cancel order');
    expect(screen.queryByText('Mark shipped')).toBeNull();
    expect(screen.queryByText('Mark completed')).toBeNull();
  });

  it('offers nothing for a terminal order, and does not call that stale', async () => {
    serve(detail({ status: 'completed', allowed_transitions: [] }));

    await renderDetail();

    await screen.findByText('Status: completed');
    expect(screen.queryByText(/Mark /)).toBeNull();
    expect(screen.queryByText('Cancel order')).toBeNull();
    expect(screen.queryByText(/out of date/)).toBeNull();
  });

  it('marks the fallback as stale when the server sent no transitions at all', async () => {
    serve(detail({}));

    await renderDetail();

    await screen.findByText(/Actions may be out of date/);
    expect(screen.getByText('Mark completed')).toBeTruthy();
  });
});
