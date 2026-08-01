import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AuthProvider } from '../../../auth/AuthContext';
import { enablePush } from '../../../notifications';
import SettingsScreen from '../settings';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../../../notifications', () => ({
  enablePush: jest.fn(),
  disablePush: jest.fn(() => Promise.resolve()),
  getStoredPushToken: jest.fn(() => Promise.resolve(null)),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

it('keeps the toggle off and alerts the user when enabling push rejects', async () => {
  // Mirrors expo-notifications@57 throwing CodedError('ERR_NOTIFICATIONS_NO_EXPERIENCE_ID')
  // when extra.eas.projectId hasn't been configured yet (pre-`eas init` repo state).
  (enablePush as jest.Mock).mockRejectedValueOnce(new Error('ERR_NOTIFICATIONS_NO_EXPERIENCE_ID'));
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  await render(
    <AuthProvider>
      <SettingsScreen />
    </AuthProvider>
  );

  const toggle = await screen.findByLabelText('New-order notifications');
  await fireEvent(toggle, 'valueChange', true);

  await waitFor(() => expect(alertSpy).toHaveBeenCalled());
  expect(toggle.props.value).toBe(false);
});
