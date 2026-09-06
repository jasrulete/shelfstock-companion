import NetInfo from '@react-native-community/netinfo';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { updateOrderStatus } from './api/orders';
import { updateProduct } from './api/products';

// Let TanStack Query pause/resume fetches based on real connectivity
// instead of the browser heuristics it defaults to.
export function wireOnlineManager() {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(!!state.isConnected))
  );
}

/**
 * Offline write queue, step 1 (roadmap Phase 3). TanStack already pauses a
 * mutation made without signal and resumes it when the network returns; the
 * persister already writes paused mutations to disk. What a restored
 * mutation lacks is its function - a closure cannot be serialised - so the
 * two keyed mutations get their functions here, by key, and the persister's
 * onSuccess (the cache is back) calls resumeQueuedWrites. Every mutation
 * that should survive a restart must carry one of these keys.
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
}

/** After the persisted cache is restored: send what was still waiting when the app closed. */
export function resumeQueuedWrites(client: QueryClient): Promise<unknown> {
  return client.resumePausedMutations();
}
