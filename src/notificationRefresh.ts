import type { QueryClient } from '@tanstack/react-query';

/**
 * What a push notification does to the running app (Roadmap 3.3).
 *
 * Dependencies are injected rather than imported so the behaviour is testable
 * without the native modules: expo-notifications, AppState and the router are
 * passed in by app/_layout.tsx and faked by the tests.
 */

type Subscription = { remove: () => void };

interface NotificationsApi {
  addNotificationReceivedListener: (listener: (event: unknown) => void) => Subscription;
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => Subscription;
}

interface AppStateApi {
  addEventListener: (type: 'change', listener: (state: string) => void) => Subscription;
}

interface Deps {
  notifications: NotificationsApi;
  appState: AppStateApi;
  queryClient: Pick<QueryClient, 'invalidateQueries'>;
  router: { push: (href: string) => void };
  focusManager: { setFocused: (focused?: boolean) => void };
  /** Several arrivals in quick succession cause one refetch. */
  debounceMs?: number;
}

/**
 * The order id from a push payload, or null.
 *
 * This is the actual defect the roadmap item leads with: the previous code
 * put whatever `data.orderId` held straight into router.push. A payload is
 * data from the network, and only a positive integer names an order.
 */
export function coerceOrderId(data: unknown): number | null {
  const raw = (data as { orderId?: unknown } | null | undefined)?.orderId;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const text = String(raw);
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function responseData(response: unknown): unknown {
  return (response as { notification?: { request?: { content?: { data?: unknown } } } } | null)
    ?.notification?.request?.content?.data;
}

/**
 * Wires three things and returns the function that unwires them:
 *
 * - A tapped notification opens its order - if the id is sane.
 * - A notification arriving while the app is open refetches the order list,
 *   debounced, so a burst of orders is one refetch rather than five.
 * - TanStack's focusManager follows AppState, so queries that went stale
 *   while the app was in the background refetch on return. React Native has
 *   no window focus event; without this, refetchOnWindowFocus never fires.
 */
export function wireNotificationRefresh({
  notifications,
  appState,
  queryClient,
  router,
  focusManager,
  debounceMs = 500,
}: Deps): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const received = notifications.addNotificationReceivedListener(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    }, debounceMs);
  });

  const responded = notifications.addNotificationResponseReceivedListener((response) => {
    const id = coerceOrderId(responseData(response));
    if (id !== null) router.push(`/orders/${id}`);
  });

  const state = appState.addEventListener('change', (next) => {
    focusManager.setFocused(next === 'active');
  });

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    received.remove();
    responded.remove();
    state.remove();
  };
}
