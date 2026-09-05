import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api/client';

export const PUSH_TOKEN_KEY = 'shelfstock_push_token';
/**
 * The admin's own choice, separate from whether a token exists. Without it,
 * the tab shell re-enabled push on every launch, so switching it off in
 * Settings lasted until the next time the app opened.
 */
export const PUSH_PREF_KEY = 'shelfstock_push_pref';

export type PushPreference = 'on' | 'off';

export async function getPushPreference(): Promise<PushPreference | null> {
  const value = await SecureStore.getItemAsync(PUSH_PREF_KEY);
  return value === 'on' || value === 'off' ? value : null;
}

/**
 * Where the OS stands, in the three states the Settings screen cares about:
 * 'blocked' means denied and the system will not ask again, so the only way
 * back is the app's page in system settings.
 */
export type PushPermissionState = 'granted' | 'denied' | 'blocked' | 'undetermined';

export async function getPushPermissionState(): Promise<PushPermissionState> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return canAskAgain ? 'denied' : 'blocked';
  return 'undetermined';
}

// Show notifications even while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function getStoredPushToken(): Promise<string | null> {
  return SecureStore.getItemAsync(PUSH_TOKEN_KEY);
}

/** Permission → Expo token → register with the API. False = declined/unavailable. */
export async function enablePush(): Promise<boolean> {
  if (!Device.isDevice) return false; // emulators without Play services can't receive push

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Orders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return false;

  const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

  await api('/api/devices', { method: 'POST', body: JSON.stringify({ token }) });
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
  await SecureStore.setItemAsync(PUSH_PREF_KEY, 'on');
  return true;
}

/**
 * What the tab shell calls on mount. An explicit "off" is honoured; anything
 * else - never chosen, or chosen "on" - enables as before, so a first launch
 * still asks for permission.
 */
export async function enablePushIfWanted(): Promise<boolean> {
  if ((await getPushPreference()) === 'off') return false;
  return enablePush();
}

/** Best-effort unregister; always clears local state and records the choice. */
export async function disablePush(): Promise<void> {
  const token = await getStoredPushToken();
  if (token) {
    await api(`/api/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {});
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  }
  // Recorded even when there was no token: "off" is the admin's decision, not
  // a description of the current registration.
  await SecureStore.setItemAsync(PUSH_PREF_KEY, 'off');
}
