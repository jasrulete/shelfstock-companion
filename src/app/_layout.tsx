import { useEffect } from 'react';
import { router, Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { AuthProvider, logoutHandlers } from '../auth/AuthContext';
import OfflineBanner from '../components/OfflineBanner';
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
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const orderId = response.notification.request.content.data?.orderId;
      if (orderId) router.push(`/orders/${orderId}`);
    });
    return () => sub.remove();
  }, []);

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
