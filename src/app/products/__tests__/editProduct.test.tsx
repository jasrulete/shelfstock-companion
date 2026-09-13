import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AuthProvider } from '../../../auth/AuthContext';
import EditProductScreen from '../[id]';

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
  useLocalSearchParams: () => ({ id: '6' }),
  Stack: { Screen: () => null },
  Redirect: () => null,
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

const fetchMock = jest.fn();
// @ts-expect-error global.fetch is assigned during tests
global.fetch = fetchMock as unknown as typeof fetch;

const PRODUCT = {
  id: 6,
  name: 'Mug',
  description: null,
  price: '9.50',
  category: 'Kitchen',
  stock: 5,
  image_url: null,
  barcode: '2000000000067',
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
});

/**
 * C-INV-8: stock moves by delta through adjust-stock, never by PUT. An edit
 * that carried an absolute count could be queued alongside stepper presses on
 * the same product and, replayed in parallel with them, land on top of what
 * they moved. So the edit screen never sends one.
 */
it('saves an edit without a stock count, and shows the count read-only', async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(PRODUCT) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <EditProductScreen />
      </AuthProvider>
    </QueryClientProvider>
  );

  await fireEvent.changeText(await screen.findByLabelText('Name'), 'Big Mug');
  expect(screen.queryByLabelText('Stock')).toBeNull();
  expect(screen.getByText(/Stock: 5/)).toBeTruthy();
  await fireEvent.press(screen.getByText('Save changes'));

  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PUT')).toBe(true)
  );
  const [url, init] = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'PUT')!;
  expect(url).toContain('/api/products/6');
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body).not.toHaveProperty('stock');
  expect(body.name).toBe('Big Mug');
});
