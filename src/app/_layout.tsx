import { useEffect } from 'react';
import { AppState } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { AuthProvider, logoutHandlers } from '../auth/AuthContext';
import OfflineBanner from '../components/OfflineBanner';
import { wireNotificationRefresh } from '../notificationRefresh';
import { wireOnlineManager } from '../offline';
import { clearPersistedCache, persistOptions, queryClient } from '../queryClient';

wireOnlineManager();

// Registered the same way (tabs)/_layout.tsx registers disablePush, rather
// than imported into AuthContext: that would pull AsyncStorage into every
// module that touches auth, including the ones under test where the native
// module does not exist.
//
// Without this the cache outlives the token. gcTime is 24 hours and the
// products have already been written to disk, so the next person to open the
// app sees the previous admin's inventory without signing in.
if (!logoutHandlers.includes(clearPersistedCache)) logoutHandlers.push(clearPersistedCache);

export default function RootLayout() {
  // A tapped notification opens its order (id validated first), an arrival
  // while the app is open refetches the list, and AppState drives TanStack's
  // focus so stale queries refetch on return. See notificationRefresh.ts.
  useEffect(
    () =>
      wireNotificationRefresh({
        notifications: Notifications,
        appState: AppState,
        queryClient,
        router,
        focusManager,
      }),
    []
  );

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <AuthProvider>
        <OfflineBanner />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ title: 'Sign in', headerShown: false }} />
          <Stack.Screen name="orders/[id]" options={{ title: 'Order' }} />
          <Stack.Screen name="products/[id]" options={{ title: 'Product' }} />
          <Stack.Screen name="products/new" options={{ title: 'New product' }} />
          <Stack.Screen name="scan" options={{ title: 'Scan barcode' }} />
        </Stack>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
