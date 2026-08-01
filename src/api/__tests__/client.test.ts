const store: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    store[k] = v;
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((k: string) => {
    delete store[k];
    return Promise.resolve();
  }),
}));

import { api, ApiError, setOnUnauthorized, TOKEN_KEY } from '../client';

const fetchMock = jest.fn();
// @ts-expect-error global.fetch is assigned during tests
global.fetch = fetchMock as unknown as typeof fetch;

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(store)) delete store[k];
  setOnUnauthorized(null);
});

it('sends the stored JWT as a Bearer header', async () => {
  store[TOKEN_KEY] = 'tok123';
  respond(200, { ok: true });

  await api('/api/orders');

  const [, init] = fetchMock.mock.calls[0];
  expect(init.headers.Authorization).toBe('Bearer tok123');
});

it('throws ApiError carrying the server error message', async () => {
  respond(400, { error: 'Invalid status filter' });

  await expect(api('/api/orders?status=nope')).rejects.toMatchObject({
    status: 400,
    message: 'Invalid status filter',
  });
});

it('fires onUnauthorized on a 401', async () => {
  const cb = jest.fn();
  setOnUnauthorized(cb);
  respond(401, { error: 'Invalid or expired token' });

  await expect(api('/api/orders')).rejects.toBeInstanceOf(ApiError);
  expect(cb).toHaveBeenCalled();
});
