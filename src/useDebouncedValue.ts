import { useEffect, useState } from 'react';

/**
 * The value as it stood `delayMs` ago, once it has stopped changing. The
 * inventory search feeds this to the query so a word typed with a thumb is
 * one request, not one per keystroke. The first render returns the value
 * as is, so an initial load is not delayed.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
