import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api/client';

export const PUSH_TOKEN_KEY = 'shelfstock_push_token';

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
  return true;
}

/** Best-effort unregister; always clears local state. */
export async function disablePush(): Promise<void> {
  const token = await getStoredPushToken();
  if (token) {
    await api(`/api/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {});
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  }
}
