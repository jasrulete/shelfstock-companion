import NetInfo from '@react-native-community/netinfo';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { updateOrderStatus } from './api/orders';
import { adjustStockOptions, updateProduct } from './api/products';

// Let TanStack Query pause/resume fetches based on real connectivity
// instead of the browser heuristics it defaults to.
export function wireOnlineManager() {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(!!state.isConnected))
  );
}

/**
 * Offline write queue (roadmap Phase 3). TanStack already pauses a mutation
 * made without signal and resumes it when the network returns; the persister
 * already writes paused mutations to disk. What a restored mutation lacks is
 * its function - a closure cannot be serialised - so the keyed mutations get
 * their functions here, by key, and the persister's onSuccess (the cache is
 * back) calls resumeQueuedWrites. Every mutation that should survive a
 * restart must carry one of these keys.
 *
 * Step 1: ['order-status'] and ['product'] - a function and the list
 * invalidations. Step 2: ['adjust-stock'], the stepper, whose default is the
 * same options the hook uses (products.ts), because a restored press must
 * reconcile the row, say why it was refused and buzz exactly like a live one,
 * and it has no hook observing it. Note that hydration restores a mutation's
 * state whole, context included: that is why adjustStockOptions never takes
 * an onMutate snapshot. Presses on one product carry a scope, so
 * resumePausedMutations runs them one at a time in press order.
 *
 * On reconnect the client awaits resumePausedMutations before it lets the
 * query cache refetch, so the reconnect refetch lands after a product's queue
 * has drained; each press's own refetch is held back while more presses for
 * that product are queued (products.ts refreshStock). What can still land
 * mid-replay is the mount-time refetch of a stale list, and the row draws its
 * unconfirmed presses beside the count rather than into it for exactly that
 * reason.
 */
export function wireOfflineQueue(client: QueryClient) {
  client.setMutationDefaults(['order-status'], {
    mutationFn: updateOrderStatus,
    onSuccess: (_data, { id }) => {
      client.invalidateQueries({ queryKey: ['orders'] });
      client.invalidateQueries({ queryKey: ['order', id] });
    },
  });
  client.setMutationDefaults(['product'], {
    mutationFn: updateProduct,
    onSuccess: (_data, { id }) => {
      client.invalidateQueries({ queryKey: ['products'] });
      client.invalidateQueries({ queryKey: ['product', id] });
    },
  });
  client.setMutationDefaults(['adjust-stock'], adjustStockOptions(client));
}

/** After the persisted cache is restored: send what was still waiting when the app closed. */
export function resumeQueuedWrites(client: QueryClient): Promise<unknown> {
  return client.resumePausedMutations();
}
