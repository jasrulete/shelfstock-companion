import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api, TOKEN_KEY } from '../../api/client';
import { AuthProvider, logoutHandlers, useAuth } from '../AuthContext';

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

const fetchMock = jest.fn();
// @ts-expect-error global.fetch is assigned during tests
global.fetch = fetchMock as unknown as typeof fetch;

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <Pressable accessibilityLabel="Log out" onPress={() => void logout()}>
      <Text>Log out</Text>
    </Pressable>
  );
}

it('runs logout once, even when a cleanup handler is itself answered 401', async () => {
  store[TOKEN_KEY] = 'expired-token';
  // The push unregistration is sent with the token that just failed, so the
  // server answers it 401 as well - which fires onUnauthorized from inside
  // logout. Without a guard that starts a second logout, and its handlers
  // run again.
  const handler = jest.fn(() =>
    api('/api/devices/t1', { method: 'DELETE' }).then(
      () => undefined,
      () => undefined
    )
  );
  logoutHandlers.push(handler);
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 401,
    json: () => Promise.resolve({ error: 'Invalid or expired token' }),
  });
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });

  try {
    await render(
      <AuthProvider>
        <LogoutButton />
      </AuthProvider>
    );
    await fireEvent.press(screen.getByLabelText('Log out'));

    await waitFor(() => expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY));
    expect(handler).toHaveBeenCalledTimes(1);
  } finally {
    logoutHandlers.splice(logoutHandlers.indexOf(handler), 1);
  }
});
