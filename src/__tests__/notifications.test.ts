import { enablePush, disablePush, getStoredPushToken, PUSH_TOKEN_KEY } from '../notifications';

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
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } },
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[t1]' })),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  AndroidImportance: { DEFAULT: 3 },
}));

const fetchMock = jest.fn();
// @ts-expect-error global.fetch is assigned during tests
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(store)) delete store[k];
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ ok: true }) });
});

it('registers the token with the API and stores it', async () => {
  await expect(enablePush()).resolves.toBe(true);
  expect(fetchMock.mock.calls[0][0]).toContain('/api/devices');
  expect(store[PUSH_TOKEN_KEY]).toBe('ExponentPushToken[t1]');
});

it('unregisters and clears the stored token', async () => {
  store[PUSH_TOKEN_KEY] = 'ExponentPushToken[t1]';

  await disablePush();

  expect(fetchMock.mock.calls[0][0]).toContain('/api/devices/ExponentPushToken%5Bt1%5D');
  expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  await expect(getStoredPushToken()).resolves.toBeNull();
});
