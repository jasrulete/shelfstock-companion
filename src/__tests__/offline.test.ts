import { QueryClient, dehydrate, hydrate, onlineManager } from '@tanstack/react-query';
import { resumeQueuedWrites, wireOfflineQueue } from '../offline';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve('token')),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => () => {}),
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
    wireOfflineQueue(bare);
    expect(bare.getMutationDefaults(['order-status']).mutationFn).toBeInstanceOf(Function);
    expect(bare.getMutationDefaults(['product']).mutationFn).toBeInstanceOf(Function);
  });
});
