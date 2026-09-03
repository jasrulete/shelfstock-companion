import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

// Lives here rather than in app/_layout.tsx so AuthContext can clear the cache
// on logout without importing the layout that renders it.

export const persister = createAsyncStoragePersister({ storage: AsyncStorage });

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, gcTime: 24 * 60 * 60 * 1000 } },
});

/**
 * AsyncStorage is not encrypted. The JWT is deliberately kept in SecureStore,
 * and order data must not undercut that: EVERY order shape carries customer
 * PII, not just the detail one. `Order` itself has shipping_name,
 * shipping_phone, shipping_address and shipping_city, and `OrderListItem`
 * extends it with user_email — so the orders LIST is as sensitive as the
 * order detail, and excluding only ['order', id] would have left names,
 * phone numbers and addresses for every order sitting in plaintext.
 *
 * The trade-off is deliberate and worth stating plainly: offline reads now
 * cover products only. An admin with no signal keeps the inventory they were
 * looking at and loses the order list. Storing a customer's home address
 * unencrypted so a shop owner can read it on the train is the wrong side of
 * that trade.
 */
function holdsCustomerPii(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'orders' || queryKey[0] === 'order';
}

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  // Bumping the app version invalidates a cache written by an older build,
  // whose shapes may no longer match. Per-user isolation is NOT handled here —
  // it comes from clearPersistedCache() on logout, because AuthProvider is
  // rendered inside the persist provider and cannot feed a user id up into it.
  buster: String(Constants.expoConfig?.version ?? 'dev'),
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' && !holdsCustomerPii(query.queryKey),
  },
};

/** Drops the in-memory cache and the copy on disk. Both, or it is not a logout. */
export async function clearPersistedCache(): Promise<void> {
  queryClient.clear();
  await persister.removeClient();
}
