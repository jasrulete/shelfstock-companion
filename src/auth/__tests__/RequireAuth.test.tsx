import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import { AuthProvider } from '../AuthContext';
import RequireAuth from '../RequireAuth';

const store: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    store[k] = v;
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

const mockRedirect = jest.fn((_props: { href: string }) => null);
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
}));

beforeEach(() => {
  jest.clearAllMocks();
  delete store['shelfstock_jwt'];
  delete store['shelfstock_user'];
});

it('redirects to login when there is no authenticated user', async () => {
  await render(
    <AuthProvider>
      <RequireAuth>
        <Text>Secret content</Text>
      </RequireAuth>
    </AuthProvider>
  );

  await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith({ href: '/login' }));
  expect(screen.queryByText('Secret content')).toBeNull();
});

it('renders its content when a user is authenticated', async () => {
  store['shelfstock_jwt'] = 't';
  store['shelfstock_user'] = JSON.stringify({ id: 1, email: 'a@b.com', role: 'admin' });

  await render(
    <AuthProvider>
      <RequireAuth>
        <Text>Secret content</Text>
      </RequireAuth>
    </AuthProvider>
  );

  await waitFor(() => expect(screen.getByText('Secret content')).toBeTruthy());
  expect(mockRedirect).not.toHaveBeenCalled();
});
