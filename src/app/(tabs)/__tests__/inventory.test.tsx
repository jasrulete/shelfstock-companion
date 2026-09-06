import { dehydrate, hydrate, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { useLowStock } from '../../../api/analytics';
import { resumeQueuedWrites, wireOfflineQueue } from '../../../offline';
import InventoryScreen from '../inventory';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve('token')),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
// offline.ts reads NetInfo at import; the native module does not exist here.
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => () => {}),
}));
// The chip's own query is mocked at the hook so the fetch-mock sequences the
// other tests rely on stay one-request-per-step.
jest.mock('../../../api/analytics', () => ({ useLowStock: jest.fn() }));
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

const adjustment = { id: 9, delta: 1, new_stock: 4, source: 'companion', note: null, created_at: '2026-01-01T00:00:00Z' };

/**
 * A stock counter behind the fetch mock: GETs list the current count, POSTs
 * apply their delta and answer with it - unless `onPost` returns a custom
 * response for that call (a deferred promise, a 409).
 */
function fakeServer(initial: number, onPost?: (delta: number, stock: number) => Promise<unknown> | undefined) {
  let stock = initial;
  fetchMock.mockImplementation((_url: unknown, init?: { method?: string; body?: string }) => {
    if (init?.method !== 'POST') return Promise.resolve(listOf(stock));
    const { delta } = JSON.parse(init.body ?? '{}') as { delta: number };
    stock += delta;
    return onPost?.(delta, stock) ?? Promise.resolve(jsonResponse(200, { stock, adjustment: { ...adjustment, delta, new_stock: stock } }));
  });
}

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'POST');
const gets = () => fetchMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method !== 'POST');
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body);
const pressBody = (delta: number) => ({ delta, source: 'companion', requestId: expect.any(String) });
/** Network changes re-render subscribed components; keep React's act bookkeeping straight. */
const setOnline = (online: boolean) => act(async () => onlineManager.setOnline(online));

let lastClient: QueryClient;

function renderInventory(existing?: QueryClient) {
  const client =
    existing ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  lastClient = client;
  return render(
    <QueryClientProvider client={client}>
      <InventoryScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  (useLowStock as jest.Mock).mockImplementation(() => ({ data: [] }));
});
afterEach(() => {
  onlineManager.setOnline(true);
});

/**
 * The stepper must go through POST /adjust-stock, never PUT with a computed
 * value: a read-modify-write from the phone silently swallows a concurrent
 * order's decrement. The server applies the delta atomically; the phone's
 * job is to show what it has asked for, beside a count the server has
 * actually confirmed, and to be honest when the server says no.
 */
describe('inventory stepper', () => {
  it('shows a press as pending beside the confirmed count, posts +1, then takes the server count', async () => {
    let resolveAdjust!: (value: unknown) => void;
    fakeServer(3, () => new Promise((resolve) => (resolveAdjust = resolve)));

    await renderInventory();
    await screen.findByText('3 in stock');

    await fireEvent.press(screen.getByLabelText('Increase stock of Widget'));

    // The server has not answered: the count stays its number, the press is beside it.
    expect(await screen.findByText('+1 pending')).toBeTruthy();
    expect(screen.getByText('3 in stock')).toBeTruthy();
    expect(screen.queryByText('4 in stock')).toBeNull();
    expect(Haptics.impactAsync).toHaveBeenCalled();
    expect(posts()).toHaveLength(1);
    expect(String(posts()[0][0])).toContain('/api/products/1/adjust-stock');
    expect(bodyOf(posts()[0])).toEqual(pressBody(1));

    resolveAdjust(jsonResponse(200, { stock: 4, adjustment }));
    expect(await screen.findByText('4 in stock')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/pending/)).toBeNull());
    expect(Haptics.notificationAsync).not.toHaveBeenCalledWith('error');
  });

  it('a refusal lands the row on the count the server sent, says why, and buzzes', async () => {
    fetchMock
      .mockResolvedValueOnce(listOf(3))
      .mockResolvedValueOnce(jsonResponse(409, { error: 'Only 2 in stock; cannot remove 1', stock: 2 }))
      .mockImplementation(() => new Promise(() => {}));

    await renderInventory();
    await screen.findByText('3 in stock');

    await fireEvent.press(screen.getByLabelText('Decrease stock of Widget'));

    await waitFor(() => expect(Haptics.notificationAsync).toHaveBeenCalledWith('error'));
    // Only the 409 body can produce this number: every refetch hangs.
    expect(await screen.findByText('2 in stock')).toBeTruthy();
    expect(await screen.findByText(/Refused: Only 2 in stock/)).toBeTruthy();
    expect(screen.queryByText('3 in stock')).toBeNull();
    expect(screen.queryByText(/pending/)).toBeNull();
  });

  it('a refusal without a count moves nothing, and still says why', async () => {
    fetchMock
      .mockResolvedValueOnce(listOf(3))
      .mockResolvedValueOnce(jsonResponse(409, { error: 'Insufficient stock' }))
      .mockImplementation(() => new Promise(() => {}));

    await renderInventory();
    await screen.findByText('3 in stock');

    await fireEvent.press(screen.getByLabelText('Decrease stock of Widget'));

    await waitFor(() => expect(Haptics.notificationAsync).toHaveBeenCalledWith('error'));
    expect(await screen.findByText('Refused: Insufficient stock')).toBeTruthy();
    expect(screen.getByText('3 in stock')).toBeTruthy();
    expect(screen.queryByText('2 in stock')).toBeNull();
  });

  it('will not decrease below zero, and does not ask the server to', async () => {
    fetchMock.mockResolvedValue(listOf(0));

    await renderInventory();
    await screen.findByText('0 in stock');

    const minus = screen.getByLabelText('Decrease stock of Widget');
    expect(minus.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(minus);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends presses on one product one at a time, in order', async () => {
    let resolveFirst: ((value: unknown) => void) | null = null;
    fakeServer(3, () => {
      if (resolveFirst) return undefined; // the second press answers at once
      return new Promise((resolve) => (resolveFirst = resolve));
    });

    await renderInventory();
    await screen.findByText('3 in stock');

    await fireEvent.press(screen.getByLabelText('Increase stock of Widget'));
    await fireEvent.press(screen.getByLabelText('Increase stock of Widget'));

    expect(await screen.findByText('+2 pending')).toBeTruthy();
    expect(screen.getByText('3 in stock')).toBeTruthy();
    // The second press waits its turn: one request in flight, not two.
    expect(posts()).toHaveLength(1);

    resolveFirst!(jsonResponse(200, { stock: 4, adjustment }));
    expect(await screen.findByText('5 in stock')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/pending/)).toBeNull());
    expect(posts()).toHaveLength(2);
    expect(posts().map(bodyOf)).toEqual([pressBody(1), pressBody(1)]);
    // Each press has its own id; a replay of the same press would reuse it.
    expect(bodyOf(posts()[0]).requestId).not.toBe(bodyOf(posts()[1]).requestId);
    // Only the last press of the run refetched the list: the load, then one.
    await waitFor(() => expect(gets()).toHaveLength(2));
  });

  it('a press that never got an answer is not applied, says so, and is not queued', async () => {
    fetchMock
      .mockResolvedValueOnce(listOf(3))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockImplementation(() => new Promise(() => {}));

    await renderInventory();
    await screen.findByText('3 in stock');

    await fireEvent.press(screen.getByLabelText('Increase stock of Widget'));

    expect(await screen.findByText('Not applied: Network request failed')).toBeTruthy();
    expect(screen.getByText('3 in stock')).toBeTruthy();
    expect(screen.queryByText(/pending/)).toBeNull();
    expect(screen.queryByText(/Refused/)).toBeNull();
  });

  it('a refusal stops being shown once the count has moved on', async () => {
    let resolveRefetch!: (value: unknown) => void;
    fetchMock
      .mockResolvedValueOnce(listOf(3))
      .mockResolvedValueOnce(jsonResponse(409, { error: 'Only 2 in stock; cannot remove 1', stock: 2 }))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveRefetch = resolve)))
      .mockImplementation(() => new Promise(() => {}));

    await renderInventory();
    await screen.findByText('3 in stock');
    await fireEvent.press(screen.getByLabelText('Decrease stock of Widget'));
    expect(await screen.findByText(/Refused: Only 2 in stock/)).toBeTruthy();
    expect(screen.getByText('2 in stock')).toBeTruthy();

    // Someone restocked meanwhile: the refetch says 5, and the 409's "only 2"
    // no longer describes anything on the shelf.
    resolveRefetch(listOf(5));
    expect(await screen.findByText('5 in stock')).toBeTruthy();
    expect(screen.queryByText(/Refused/)).toBeNull();
  });
});

/**
 * Roadmap Phase 3, offline write queue - step 2. The stepper keeps working
 * without signal: presses queue beside the confirmed count, the queue is
 * written to disk with the server's numbers (never ours), and it drains one
 * press per product at a time once back online or on the next launch.
 */
describe('inventory stepper, offline', () => {
  it('presses queue beside the confirmed count, the stepper stays usable, and the queue drains once online', async () => {
    fakeServer(3);
    await renderInventory();
    await screen.findByText('3 in stock');

    await setOnline(false);
    await fireEvent.press(screen.getByLabelText('Increase stock of Widget'));
    await fireEvent.press(screen.getByLabelText('Increase stock of Widget'));

    expect(await screen.findByText('+2 pending')).toBeTruthy();
    expect(screen.getByText('3 in stock')).toBeTruthy();
    expect(posts()).toHaveLength(0);
    expect(screen.getByLabelText('Decrease stock of Widget').props.accessibilityState?.disabled).toBe(false);

    // What the persister would write to disk: the presses, keyed and scoped,
    // and a list holding the server's 3 - not our 5.
    const state = dehydrate(lastClient);
    expect(state.mutations).toHaveLength(2);
    for (const m of state.mutations) {
      expect(m.mutationKey).toEqual(['adjust-stock']);
      expect(m.scope).toEqual({ id: 'stock:1' });
      expect(m.state.isPaused).toBe(true);
      expect(m.state.context).toBeUndefined();
    }
    const list = state.queries.find((q) => q.queryKey[0] === 'products')!.state.data as { products: { stock: number }[] };
    expect(list.products[0].stock).toBe(3);

    await setOnline(true);
    expect(await screen.findByText('5 in stock')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/pending/)).toBeNull());
    expect(posts().map(bodyOf)).toEqual([pressBody(1), pressBody(1)]);
  });

  it('will not queue a decrease the queued presses already spend', async () => {
    fakeServer(1);
    await renderInventory();
    await screen.findByText('1 in stock');

    await setOnline(false);
    const minus = screen.getByLabelText('Decrease stock of Widget');
    await fireEvent.press(minus);

    expect(await screen.findByText('-1 pending')).toBeTruthy();
    expect(screen.getByText('1 in stock')).toBeTruthy();
    await waitFor(() => expect(minus.props.accessibilityState?.disabled).toBe(true));
    expect(posts()).toHaveLength(0);

    await fireEvent.press(screen.getByLabelText('Increase stock of Widget'));
    await waitFor(() => expect(screen.queryByText(/pending/)).toBeNull());
    expect(screen.getByLabelText('Decrease stock of Widget').props.accessibilityState?.disabled).toBe(false);
  });

  it('a refusal in the middle of a queue yields to the press that lands after it', async () => {
    // First press refused with no count in the body (so only the "a later
    // press landed" rule can clear the notice), second press applied.
    let calls = 0;
    fakeServer(1, (delta, stock) => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(jsonResponse(409, { error: 'Insufficient stock' }))
        : Promise.resolve(jsonResponse(200, { stock, adjustment: { ...adjustment, delta, new_stock: stock } }));
    });
    await renderInventory();
    await screen.findByText('1 in stock');

    await setOnline(false);
    await fireEvent.press(screen.getByLabelText('Decrease stock of Widget'));
    expect(await screen.findByText('-1 pending')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Increase stock of Widget'));
    // Two presses queued that cancel out: nothing to annotate, nothing sent.
    await waitFor(() => expect(screen.queryByText(/pending/)).toBeNull());
    expect(posts()).toHaveLength(0);

    await setOnline(true);
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(await screen.findByText('1 in stock')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/pending/)).toBeNull());
    // The refusal was real and buzzed, but the count has since moved on
    // through a later press; the notice has nothing left to say.
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');
    await waitFor(() => expect(screen.queryByText(/Refused|Not applied/)).toBeNull());
  });

  it('after a relaunch, a queued press the server refuses lands on the server count, says why, and buzzes', async () => {
    // The persister has restored a list holding the server's 3 and one paused
    // -1 press; no hook has ever observed this mutation.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wireOfflineQueue(client);
    client.setQueryData(['products', ''], { products: [{ ...widget, stock: 3 }], pagination });
    hydrate(client, {
      queries: [],
      mutations: [
        {
          mutationKey: ['adjust-stock'],
          scope: { id: 'stock:1' },
          state: {
            status: 'pending',
            isPaused: true,
            variables: { id: 1, delta: -1, requestId: 'press-from-yesterday' },
            context: undefined,
            data: undefined,
            error: null,
            failureCount: 0,
            failureReason: null,
            submittedAt: 0,
          },
        },
      ],
    });
    // Only the 409 body can move the row: every list fetch hangs.
    fetchMock.mockImplementation((_url: unknown, init?: { method?: string }) =>
      init?.method === 'POST'
        ? Promise.resolve(jsonResponse(409, { error: 'Only 0 in stock; cannot remove 1', stock: 0 }))
        : new Promise(() => {})
    );

    await setOnline(false);
    await renderInventory(client);
    await resumeQueuedWrites(client); // the persister's onSuccess; nothing to do without signal

    expect(await screen.findByText('3 in stock')).toBeTruthy();
    expect(screen.getByText('-1 pending')).toBeTruthy();
    expect(posts()).toHaveLength(0);

    await setOnline(true);

    await waitFor(() => expect(Haptics.notificationAsync).toHaveBeenCalledWith('error'));
    expect(await screen.findByText('0 in stock')).toBeTruthy();
    expect(await screen.findByText(/Refused: Only 0 in stock/)).toBeTruthy();
    expect(screen.queryByText(/pending/)).toBeNull();
    // The replay carries the id the press was made with - the server's dedupe key.
    expect(bodyOf(posts()[0])).toEqual({ delta: -1, source: 'companion', requestId: 'press-from-yesterday' });
  });
});

/**
 * Roadmap Phase 3, list ergonomics: a word typed with a thumb is one
 * request, the last list stays up while the next one loads, and a failed
 * load says so and offers a way to try again - it is not an empty shelf.
 */
describe('inventory search and load states', () => {
  const urls = () => fetchMock.mock.calls.map((call) => String(call[0]));

  it('asks the server once per pause in typing, not once per keystroke', async () => {
    fetchMock.mockResolvedValue(listOf(3));
    await renderInventory();
    await screen.findByText('Widget');

    const input = screen.getByPlaceholderText('Search products');
    await fireEvent.changeText(input, 'w');
    await fireEvent.changeText(input, 'wi');
    await fireEvent.changeText(input, 'wid');

    await waitFor(() => expect(urls().some((u) => u.includes('search=wid'))).toBe(true));
    expect(urls().filter((u) => u.includes('search='))).toEqual([expect.stringContaining('search=wid')]);
  });

  it('keeps the last list on screen while the next search loads', async () => {
    let resolveNext!: (value: unknown) => void;
    fetchMock
      .mockResolvedValueOnce(listOf(3))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveNext = resolve)));
    await renderInventory();
    await screen.findByText('Widget');

    await fireEvent.changeText(screen.getByPlaceholderText('Search products'), 'gad');
    await waitFor(() => expect(urls().some((u) => u.includes('search=gad'))).toBe(true));

    expect(screen.getByText('Widget')).toBeTruthy();
    expect(screen.queryByText('No products')).toBeNull();

    resolveNext(jsonResponse(200, { products: [{ ...widget, id: 2, name: 'Gadget' }], pagination }));
    expect(await screen.findByText('Gadget')).toBeTruthy();
    expect(screen.queryByText('Widget')).toBeNull();
  });

  it('says the list could not load, and Retry asks again', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(listOf(3));
    await renderInventory();

    expect(await screen.findByText(/couldn.t load products/i)).toBeTruthy();
    expect(screen.queryByText('No products')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Widget')).toBeTruthy();
    expect(screen.queryByText(/couldn.t load products/i)).toBeNull();
  });
});

/**
 * Roadmap Phase 3, low-stock chip: how many products are at or under the
 * threshold, from GET /api/analytics/low-stock, and nothing more.
 */
describe('low-stock chip', () => {
  it('says how many products are low', async () => {
    (useLowStock as jest.Mock).mockImplementation(() => ({
      data: [
        { id: 1, name: 'Widget', stock: 3 },
        { id: 2, name: 'Gadget', stock: 0 },
      ],
    }));
    fetchMock.mockResolvedValue(listOf(3));
    await renderInventory();

    expect(await screen.findByText('2 low on stock')).toBeTruthy();
  });

  it('shows no chip when nothing is low', async () => {
    fetchMock.mockResolvedValue(listOf(3));
    await renderInventory();

    await screen.findByText('Widget');
    expect(screen.queryByText(/low on stock/)).toBeNull();
  });

  it('recounts after a stepper press', async () => {
    fetchMock.mockImplementation((_url: unknown, init?: { method?: string }) =>
      Promise.resolve(init?.method === 'POST' ? jsonResponse(200, { ...widget, stock: 4 }) : listOf(3))
    );
    await renderInventory();
    await screen.findByText('Widget');
    const invalidate = jest.spyOn(lastClient, 'invalidateQueries');

    await fireEvent.press(screen.getByLabelText('Increase stock of Widget'));

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['low-stock'] }));
  });
});
