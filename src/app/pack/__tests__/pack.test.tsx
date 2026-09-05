import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { AuthProvider } from '../../../auth/AuthContext';
import PackScreen from '../[id]';

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
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

// The camera is the one thing that cannot run under Jest. The mock renders
// nothing and hands its onBarcodeScanned callback to the test, which then
// "scans" by calling it - the same entry point a real scan uses.
let mockScan: ((e: { data: string }) => void) | null = null;
jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
    CameraView: (props: { onBarcodeScanned: (e: { data: string }) => void }) => {
      mockScan = props.onBarcodeScanned;
      return React.createElement(View, { testID: 'camera' });
    },
  };
});

const fetchMock = jest.fn();
// @ts-expect-error global.fetch is assigned during tests
global.fetch = fetchMock as unknown as typeof fetch;

function item(id: number, name: string, quantity: number, barcode: string | null) {
  return { id, order_id: 5, product_id: id + 100, quantity, price_at_purchase: '1.00', product_name: name, barcode };
}

function order(items: ReturnType<typeof item>[], status = 'pending') {
  return {
    id: 5,
    user_id: 2,
    total_amount: '10.00',
    currency: 'USD',
    status,
    payment_method: 'cod',
    shipping_name: 'A',
    shipping_phone: '1',
    shipping_address: 'x',
    shipping_city: 'y',
    created_at: '2026-01-01T00:00:00Z',
    allowed_transitions: ['shipped', 'completed', 'cancelled'],
    items,
  };
}

const MUG = item(1, 'Mug', 2, '2000000000060');
const PEN = item(2, 'Pen', 1, '2000000000077');
const UNLABELLED = item(3, 'Unlabelled', 1, null);

function serve(body: unknown) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

/** The status change, wherever it sits among the order fetches and refetches. */
function patchCall() {
  return fetchMock.mock.calls.find(
    ([url, init]) => String(url).includes('/api/orders/5/status') && init?.method === 'PATCH'
  );
}

// Cleared on teardown: a QueryClient left alive keeps gc timers and any
// in-flight refetch from a just-finished mutation, and that work then lands
// during the next test, outside any act scope, and swallows its render.
let lastClient: QueryClient | null = null;

async function renderPack() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  lastClient = client;
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <PackScreen />
      </AuthProvider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  lastClient?.clear();
  lastClient = null;
});

// The screen ignores the same code again within 1.5s, because a camera
// reports a code many times while it is in view. Two consecutive scans of one
// code are deliberate here, so the clock jumps two seconds for each scan -
// and ONLY for the scan: findBy* measures its own timeout with Date.now, and a
// stub left in place makes every wait give up on its first tick.
//
// `act` is async in this RNTL version and must be awaited: a sync act(() =>)
// leaves the state update queued in a scope that never closes, so the updater
// never runs - and the leaked scope swallows the next test's render too.
let clock = 1_700_000_000_000;
async function scan(code: string) {
  const spy = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 2_000));
  try {
    await act(async () => {
      mockScan!({ data: code });
    });
  } finally {
    spy.mockRestore();
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  mockScan = null;
});

describe('pack & verify', () => {
  it('ticks lines off as their codes are scanned, refuses strangers and extras, and unlocks shipping only when the box matches', async () => {
    serve(order([MUG, PEN]));
    await renderPack();
    await screen.findByText('Mug');
    expect(screen.queryByText('Mark shipped')).toBeNull();
    expect(screen.getByText('Ship anyway (2 unverified)')).toBeTruthy();

    await scan('2000000000060');
    expect(await screen.findByText('Mug — 1 of 2')).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenLastCalledWith('success');

    await scan('4006381333931');
    expect(await screen.findByText('Not in this order')).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenLastCalledWith('error');

    await scan('2000000000060');
    expect(await screen.findByText('Mug — 2 of 2')).toBeTruthy();
    expect(screen.getByText('✓ Mug')).toBeTruthy();

    await scan('2000000000060');
    expect(await screen.findByText('Mug is already fully scanned')).toBeTruthy();
    expect(screen.getByLabelText('Mug, 2 of 2')).toBeTruthy();

    expect(screen.queryByText('Mark shipped')).toBeNull();
    await scan('2000000000077');
    expect(await screen.findByText('Mark shipped')).toBeTruthy();

    fireEvent.press(screen.getByText('Mark shipped'));
    await waitFor(() => expect(patchCall()).toBeDefined());
    const [, init] = patchCall()!;
    expect(JSON.parse(init.body)).toEqual({ status: 'shipped' });
    // Let the mutation settle inside this test: success navigates back.
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/orders/5'));
  });

  it('a line with no barcode keeps the box unverifiable; "Ship anyway" confirms and tells the server what it skipped', async () => {
    serve(order([MUG, UNLABELLED]));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderPack();
    await screen.findByText('Unlabelled');
    expect(screen.getByText('no barcode')).toBeTruthy();

    await scan('2000000000060');
    await scan('2000000000060');
    await screen.findByText('Mug — 2 of 2');

    expect(screen.queryByText('Mark shipped')).toBeNull();
    fireEvent.press(screen.getByText('Ship anyway (1 unverified)'));

    expect(alertSpy).toHaveBeenCalled();
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    expect(buttons.map((b) => b.text)).toEqual(['Keep packing', 'Ship anyway']);
    // Called plainly, not inside act(): wrapping a handler that starts a
    // TanStack mutation in a manual async act leaves React's act bookkeeping
    // in a state where the NEXT test's render never commits. waitFor below
    // tracks the resulting updates on its own.
    buttons[1].onPress!();

    await waitFor(() => expect(patchCall()).toBeDefined());
    const [, init] = patchCall()!;
    expect(JSON.parse(init.body)).toEqual({
      status: 'shipped',
      note: 'Shipped with 1 of 2 lines unverified',
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/orders/5'));
    alertSpy.mockRestore();
  });

  it('has nothing to pack for an order that is not pending', async () => {
    serve(order([MUG], 'shipped'));
    await renderPack();
    expect(await screen.findByText(/nothing to pack/)).toBeTruthy();
    expect(screen.queryByTestId('camera')).toBeNull();
  });
});
