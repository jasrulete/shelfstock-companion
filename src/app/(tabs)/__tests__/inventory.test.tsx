import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import InventoryScreen from '../inventory';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve('token')),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Error: 'error', Success: 'success' },
}));

const fetchMock = jest.fn();
// @ts-expect-error global.fetch is assigned during tests
global.fetch = fetchMock as unknown as typeof fetch;

const widget = {
  id: 1,
  name: 'Widget',
  description: null,
  price: '9.99',
  category: 'Tools',
  stock: 3,
  image_url: null,
  barcode: null,
  created_at: '2026-01-01T00:00:00Z',
};
const pagination = { page: 1, limit: 50, total: 1, totalPages: 1 };

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: () => Promise.resolve(body) };
}

function listOf(stock: number) {
  return jsonResponse(200, { products: [{ ...widget, stock }], pagination });
}

function renderInventory() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <InventoryScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
});

/**
 * The stepper must go through POST /adjust-stock, never PUT with a computed
 * value: a read-modify-write from the phone silently swallows a concurrent
 * order's decrement. The server applies the delta atomically; the phone's
 * job is to show the number moving immediately and to be honest when the
 * server says no.
 */
describe('inventory stepper', () => {
  it('bumps the row optimistically, posts a +1 companion adjustment, then settles on the server count', async () => {
    let resolveAdjust!: (value: unknown) => void;
    const adjust = new Promise((resolve) => {
      resolveAdjust = resolve;
    });
    fetchMock
      .mockResolvedValueOnce(listOf(3))
      .mockImplementationOnce(() => adjust)
      .mockResolvedValue(listOf(4));

    await renderInventory();
    await screen.findByText('3 in stock');

    fireEvent.press(screen.getByLabelText('Increase stock of Widget'));

    // Optimistic: the number moves before the server has answered.
    await screen.findByText('4 in stock');
    expect(Haptics.impactAsync).toHaveBeenCalled();

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain('/api/products/1/adjust-stock');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ delta: 1, source: 'companion' });

    resolveAdjust(
      jsonResponse(200, {
        stock: 4,
        adjustment: { id: 9, delta: 1, new_stock: 4, source: 'companion', note: null, created_at: '2026-01-01T00:00:00Z' },
      })
    );
    await waitFor(() => expect(screen.getByText('4 in stock')).toBeTruthy());
    expect(Haptics.notificationAsync).not.toHaveBeenCalledWith('error');
  });

  it('rolls the row back and buzzes when the server refuses', async () => {
    fetchMock
      .mockResolvedValueOnce(listOf(3))
      .mockResolvedValueOnce(jsonResponse(409, { error: 'Insufficient stock' }))
      .mockImplementation(() => new Promise(() => {}));

    await renderInventory();
    await screen.findByText('3 in stock');

    fireEvent.press(screen.getByLabelText('Decrease stock of Widget'));

    await waitFor(() => expect(Haptics.notificationAsync).toHaveBeenCalledWith('error'));
    await screen.findByText('3 in stock');
    expect(screen.queryByText('2 in stock')).toBeNull();
  });

  it('will not decrease below zero, and does not ask the server to', async () => {
    fetchMock.mockResolvedValue(listOf(0));

    await renderInventory();
    await screen.findByText('0 in stock');

    const minus = screen.getByLabelText('Decrease stock of Widget');
    expect(minus.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(minus);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
