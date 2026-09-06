import { StyleSheet, Text } from 'react-native';
import { useMutationState } from '@tanstack/react-query';

/**
 * Shows how many writes are waiting for the network. A mutation made offline
 * is paused by TanStack (networkMode 'online'), not failed; without this the
 * button just says "Updating…" and nothing explains why.
 */
export default function QueuedBanner() {
  const paused = useMutationState({
    filters: { status: 'pending' },
    select: (mutation) => mutation.state.isPaused,
  }).filter(Boolean).length;
  if (paused === 0) return null;
  return (
    <Text style={styles.banner} accessibilityRole="alert">
      {paused} queued — sends when you&apos;re back online
    </Text>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#2c3e50',
    color: '#fff',
    textAlign: 'center',
    paddingVertical: 6,
    fontWeight: '600',
  },
});
