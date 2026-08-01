const store: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    store[k] = v;
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AuthProvider } from '../AuthContext';
import LoginScreen from '../../app/login';

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

it('shows the server error on failed login', async () => {
  respond(401, { error: 'Invalid email or password' });

  await render(
    <AuthProvider>
      <LoginScreen />
    </AuthProvider>
  );
  await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'a@b.com');
  await fireEvent.changeText(screen.getByPlaceholderText('Password'), 'wrongpass');
  await fireEvent.press(screen.getByLabelText('Sign in'));

  await waitFor(() => expect(screen.getByText('Invalid email or password')).toBeTruthy());
});

it('blocks non-admin accounts with a clear message', async () => {
  respond(200, { user: { id: 2, email: 'a@b.com', role: 'customer' }, token: 't' });

  await render(
    <AuthProvider>
      <LoginScreen />
    </AuthProvider>
  );
  await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'a@b.com');
  await fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password1');
  await fireEvent.press(screen.getByLabelText('Sign in'));

  await waitFor(() => expect(screen.getByText('This app is for store admins.')).toBeTruthy());
});
