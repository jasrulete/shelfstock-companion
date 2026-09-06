import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AuthProvider } from '../../../auth/AuthContext';
import { enablePush, getPushPermissionState } from '../../../notifications';
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
  getPushPermissionState: jest.fn(() => Promise.resolve('granted')),
}));


beforeEach(() => {
  jest.clearAllMocks();
});

it('says so, and points at system settings, when notifications are blocked by the OS', async () => {
  (getPushPermissionState as jest.Mock).mockResolvedValueOnce('blocked');

  await render(
    <AuthProvider>
      <SettingsScreen />
    </AuthProvider>
  );

  expect(await screen.findByText(/turned off for this app in system settings/)).toBeTruthy();
  expect(screen.getByText('Open settings')).toBeTruthy();
  const toggle = screen.getByLabelText('New-order notifications');
  expect(toggle.props.disabled ?? toggle.props.accessibilityState?.disabled).toBe(true);
});

it('shows no system-settings notice when the OS permission is merely undecided', async () => {
  (getPushPermissionState as jest.Mock).mockResolvedValueOnce('undetermined');

  await render(
    <AuthProvider>
      <SettingsScreen />
    </AuthProvider>
  );

  await screen.findByLabelText('New-order notifications');
  expect(screen.queryByText('Open settings')).toBeNull();
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
