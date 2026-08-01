import { useEffect } from 'react';
import { router, Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { AuthProvider } from '../auth/AuthContext';
import OfflineBanner from '../components/OfflineBanner';
import { wireOnlineManager } from '../offline';

wireOnlineManager();

const persister = createAsyncStoragePersister({ storage: AsyncStorage });

// Module scope: survives fast-refresh, one cache for the app.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, gcTime: 24 * 60 * 60 * 1000 } },
});

export default function RootLayout() {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const orderId = response.notification.request.content.data?.orderId;
      if (orderId) router.push(`/orders/${orderId}`);
    });
    return () => sub.remove();
  }, []);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
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
