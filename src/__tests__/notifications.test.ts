import * as Notifications from 'expo-notifications';
import {
  enablePush,
  enablePushIfWanted,
  disablePush,
  getPushPermissionState,
  getPushPreference,
  getStoredPushToken,
  PUSH_PREF_KEY,
  PUSH_TOKEN_KEY,
} from '../notifications';

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

/**
 * Roadmap Phase 3, notification preferences. The tab shell used to call
 * enablePush() unconditionally on every mount, so switching push off in
 * Settings lasted exactly until the next launch. The choice is now recorded
 * and honoured; only an explicit "off" is.
 */
describe('the push preference', () => {
  it('is recorded as "off" by disablePush, and enablePushIfWanted then does nothing', async () => {
    store[PUSH_TOKEN_KEY] = 'ExponentPushToken[t1]';
    await disablePush();
    expect(store[PUSH_PREF_KEY]).toBe('off');

    fetchMock.mockClear();
    await expect(enablePushIfWanted()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(getStoredPushToken()).resolves.toBeNull();
  });

  it('is recorded as "off" even when there was no token to unregister', async () => {
    await disablePush();
    expect(store[PUSH_PREF_KEY]).toBe('off');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is recorded as "on" by a successful enablePush', async () => {
    await expect(enablePush()).resolves.toBe(true);
    expect(store[PUSH_PREF_KEY]).toBe('on');
    await expect(getPushPreference()).resolves.toBe('on');
  });

  it('enables on a first launch, when no choice has been made yet', async () => {
    await expect(getPushPreference()).resolves.toBeNull();
    await expect(enablePushIfWanted()).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/devices');
  });

  it('treats a stored value that is neither on nor off as no choice', async () => {
    store[PUSH_PREF_KEY] = 'maybe';
    await expect(getPushPreference()).resolves.toBeNull();
  });
});

describe('getPushPermissionState', () => {
  const permissions = Notifications.getPermissionsAsync as jest.Mock;

  it.each([
    [{ status: 'granted', canAskAgain: true }, 'granted'],
    [{ status: 'denied', canAskAgain: true }, 'denied'],
    [{ status: 'denied', canAskAgain: false }, 'blocked'],
    [{ status: 'undetermined', canAskAgain: true }, 'undetermined'],
  ])('%j -> %s', async (answer, expected) => {
    permissions.mockResolvedValueOnce(answer);
    await expect(getPushPermissionState()).resolves.toBe(expected);
  });
});
