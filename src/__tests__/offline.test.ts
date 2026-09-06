import { QueryClient, dehydrate, hydrate, onlineManager } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { RETRY_DELAY_MS } from '../api/products';
import { resumeQueuedWrites, wireOfflineQueue } from '../offline';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve('token')),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => () => {}),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Error: 'error', Success: 'success' },
}));

const fetchMock = jest.fn();
// @ts-expect-error global.fetch is assigned during tests
global.fetch = fetchMock as unknown as typeof fetch;

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function wiredClient() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  wireOfflineQueue(client);
  // The provider mounts the client in the app; mounting is what subscribes
  // it to the online manager, so a paused mutation resumes on its own.
  client.mount();
  return client;
}

async function until(condition: () => boolean) {
  for (let i = 0; i < 50 && !condition(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(condition()).toBe(true);
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
});
afterEach(() => {
  onlineManager.setOnline(true);
});

/**
 * Roadmap Phase 3, offline write queue - step 1 only. A status change or a
 * product edit made without signal waits instead of failing, and one that
 * was still waiting when the app closed is sent on the next launch.
 */
describe('offline write queue', () => {
  it('a status change made offline waits, then sends once back online', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 5, status: 'shipped' }));
    onlineManager.setOnline(false);
    const client = wiredClient();

    const mutation = client
      .getMutationCache()
      .build(client, client.defaultMutationOptions({ mutationKey: ['order-status'] }));
    const done = mutation.execute({ id: 5, status: 'shipped' });

    await until(() => mutation.state.isPaused);
    expect(fetchMock).not.toHaveBeenCalled();

    onlineManager.setOnline(true);
    await done;

    expect(mutation.state.status).toBe('success');
    expect(fetchMock.mock.calls[0][0]).toContain('/api/orders/5/status');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: 'shipped' });
  });

  it('a queued product edit survives a restart: dehydrated paused, rehydrated with its function, resumed', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 9, price: '4.50' }));
    onlineManager.setOnline(false);
    const before = wiredClient();
    const mutation = before
      .getMutationCache()
      .build(before, before.defaultMutationOptions({ mutationKey: ['product'] }));
    void mutation.execute({ id: 9, price: 4.5 }).catch(() => {});
    await until(() => mutation.state.isPaused);

    // What the persister writes to disk while the app closes.
    const state = dehydrate(before);
    expect(state.mutations).toHaveLength(1);
    expect(state.mutations[0].state.isPaused).toBe(true);
    before.getMutationCache().clear();
    before.unmount();

    // Next launch, with signal: a fresh client, defaults wired, cache
    // restored, and the persister's onSuccess resuming what was waiting.
    onlineManager.setOnline(true);
    const after = wiredClient();
    hydrate(after, state);
    await resumeQueuedWrites(after);

    const restored = after.getMutationCache().getAll()[0];
    expect(restored.state.status).toBe('success');
    const put = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/products/9'));
    expect(put).toBeDefined();
    expect(put![1].method).toBe('PUT');
    expect(JSON.parse(put![1].body)).toEqual({ price: 4.5 });
  });

  it('without the wiring a restored mutation has no function to run', () => {
    const bare = new QueryClient();
    expect(bare.getMutationDefaults(['order-status']).mutationFn).toBeUndefined();
    expect(bare.getMutationDefaults(['adjust-stock']).mutationFn).toBeUndefined();
    wireOfflineQueue(bare);
    expect(bare.getMutationDefaults(['order-status']).mutationFn).toBeInstanceOf(Function);
    expect(bare.getMutationDefaults(['product']).mutationFn).toBeInstanceOf(Function);
    expect(bare.getMutationDefaults(['adjust-stock']).mutationFn).toBeInstanceOf(Function);
  });
});

/**
 * Step 2: the stepper. What the tests above prove for a keyed function, these
 * prove for a keyed lifecycle - the restored press must move the row with the
 * server's number, never ours, in press order, and say so when refused.
 */
describe('offline write queue, step 2: the stepper', () => {
  const pagination = { page: 1, limit: 50, total: 1, totalPages: 1 };
  const list = (stock: number) => ({ products: [{ id: 1, name: 'Widget', stock }], pagination });
  const press = (client: QueryClient) =>
    client
      .getMutationCache()
      .build(client, client.defaultMutationOptions({ mutationKey: ['adjust-stock'], scope: { id: 'stock:1' } }));
  const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'POST');

  it('a press made offline waits with the count untouched, survives a restart, and the row takes the server answer', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ stock: 7, adjustment: {} }));
    onlineManager.setOnline(false);
    const before = wiredClient();
    before.setQueryData(['products', ''], list(3));
    const mutation = press(before);
    void mutation.execute({ id: 1, delta: 1, requestId: 'press-1' }).catch(() => {});
    await until(() => mutation.state.isPaused);
    expect(fetchMock).not.toHaveBeenCalled();

    // What reaches disk: the press with its key and scope, no snapshot to roll
    // back to (hydration restores context whole - a snapshot would come back),
    // and a list holding the server's 3, not our 4.
    const state = dehydrate(before);
    expect(state.mutations).toHaveLength(1);
    expect(state.mutations[0].scope).toEqual({ id: 'stock:1' });
    expect(state.mutations[0].state.variables).toEqual({ id: 1, delta: 1, requestId: 'press-1' });
    expect(state.mutations[0].state.context).toBeUndefined();
    const disk = state.queries.find((q) => q.queryKey[0] === 'products')!.state.data as ReturnType<typeof list>;
    expect(disk.products[0].stock).toBe(3);
    before.getMutationCache().clear();
    before.unmount();

    onlineManager.setOnline(true);
    const after = wiredClient();
    hydrate(after, state);
    const invalidate = jest.spyOn(after, 'invalidateQueries');
    await resumeQueuedWrites(after);

    expect(after.getMutationCache().getAll()[0].state.status).toBe('success');
    expect(String(posts()[0][0])).toContain('/api/products/1/adjust-stock');
    // The same id the press was made with: the server's key for "already applied".
    expect(JSON.parse((posts()[0][1] as { body: string }).body)).toEqual({ delta: 1, source: 'companion', requestId: 'press-1' });
    // The server's 7, not 3 + 1.
    expect(after.getQueryData<ReturnType<typeof list>>(['products', ''])!.products[0].stock).toBe(7);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['low-stock'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['product', 1] });
  });

  it('a replayed press the server refuses leaves the row on the server count and buzzes', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'Only 2 in stock; cannot remove 1', stock: 2 }),
    });
    onlineManager.setOnline(false);
    const before = wiredClient();
    before.setQueryData(['products', ''], list(3));
    const mutation = press(before);
    void mutation.execute({ id: 1, delta: -1, requestId: 'press-2' }).catch(() => {});
    await until(() => mutation.state.isPaused);
    const state = dehydrate(before);
    before.getMutationCache().clear();
    before.unmount();

    onlineManager.setOnline(true);
    const after = wiredClient();
    hydrate(after, state);
    const invalidate = jest.spyOn(after, 'invalidateQueries');
    await resumeQueuedWrites(after);

    const restored = after.getMutationCache().getAll()[0];
    expect(restored.state.status).toBe('error');
    expect(restored.state.error?.message).toBe('Only 2 in stock; cannot remove 1');
    expect(after.getQueryData<ReturnType<typeof list>>(['products', ''])!.products[0].stock).toBe(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');
  });

  it('presses on one product replay in press order, one at a time', async () => {
    let resolveFirst!: (value: unknown) => void;
    fetchMock
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValue(jsonResponse({ stock: 3, adjustment: {} }));
    onlineManager.setOnline(false);
    const client = wiredClient();
    const first = press(client);
    const second = press(client);
    void first.execute({ id: 1, delta: -1, requestId: 'press-3' }).catch(() => {});
    void second.execute({ id: 1, delta: 1, requestId: 'press-4' }).catch(() => {});
    await until(() => first.state.isPaused && second.state.isPaused);

    onlineManager.setOnline(true);
    await until(() => posts().length === 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(posts()).toHaveLength(1); // the second waits for the first

    resolveFirst(jsonResponse({ stock: 2, adjustment: {} }));
    await until(() => posts().length === 2);
    expect(posts().map((c) => JSON.parse((c[1] as { body: string }).body).delta)).toEqual([-1, 1]);
    await until(() => second.state.status === 'success');
  });

  it('a press whose request never got an answer is sent once more, with the same id', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValue(jsonResponse({ stock: 4, adjustment: {} }));
    const client = wiredClient();
    client.setQueryData(['products', ''], list(3));

    const mutation = press(client);
    await mutation.execute({ id: 1, delta: 1, requestId: 'press-5' });

    expect(mutation.state.status).toBe('success');
    expect(posts()).toHaveLength(2);
    expect(posts().map((c) => JSON.parse((c[1] as { body: string }).body).requestId)).toEqual(['press-5', 'press-5']);
    expect(client.getQueryData<ReturnType<typeof list>>(['products', ''])!.products[0].stock).toBe(4);
  });

  it('a second failure is the one that counts: two lost requests, then Not applied', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockImplementation(() => new Promise(() => {}));
    const client = wiredClient();
    const mutation = press(client);
    await mutation.execute({ id: 1, delta: 1, requestId: 'press-8' }).catch(() => {});

    expect(mutation.state.status).toBe('error');
    expect(posts()).toHaveLength(2);
  });

  it('a gateway 5xx is not the server verdict and is retried once too', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 502, json: () => Promise.reject(new Error('not json')) })
      .mockResolvedValue(jsonResponse({ stock: 4, adjustment: {} }));
    const client = wiredClient();
    const mutation = press(client);
    await mutation.execute({ id: 1, delta: 1, requestId: 'press-9' });

    expect(mutation.state.status).toBe('success');
    expect(posts()).toHaveLength(2);
  });

  it('a refusal is the server answer and is not retried', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'Only 0 in stock; cannot remove 1', stock: 0 }),
    });
    const client = wiredClient();
    const mutation = press(client);
    // execute() settles only after the retry decision, so a retried refusal
    // would already show as a second POST here.
    await mutation.execute({ id: 1, delta: -1, requestId: 'press-6' }).catch(() => {});

    expect(mutation.state.status).toBe('error');
    expect(posts()).toHaveLength(1);
  });

  it('a retry that comes due without signal pauses with the queue instead of failing', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const client = wiredClient();
    const mutation = press(client);
    const done = mutation.execute({ id: 1, delta: 1, requestId: 'press-7' }).catch(() => {});
    await until(() => posts().length === 1);
    onlineManager.setOnline(false);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS + 100));

    expect(mutation.state.status).toBe('pending');
    expect(mutation.state.isPaused).toBe(true);
    expect(posts()).toHaveLength(1);

    fetchMock.mockResolvedValue(jsonResponse({ stock: 4, adjustment: {} }));
    onlineManager.setOnline(true);
    await done;
    expect(mutation.state.status).toBe('success');
    expect(posts()).toHaveLength(2);
  });
});