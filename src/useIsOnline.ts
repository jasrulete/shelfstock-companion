import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

const subscribe = (onChange: () => void) => onlineManager.subscribe(onChange);
const getSnapshot = () => onlineManager.isOnline();

/**
 * What TanStack itself believes about the network - the same source that
 * pauses a mutation - as a subscription, so a component re-renders when the
 * network drops, not only when the mutation cache next changes.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
