import { StyleSheet, Text } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function OfflineBanner() {
  const { isConnected } = useNetInfo();
  // The banner sits above the navigator, so nothing else keeps it out from
  // under the status bar / notch. Pad by the top inset so the text is
  // readable - and reachable by a screen reader - on every device.
  const insets = useSafeAreaInsets();
  if (isConnected !== false) return null; // null = unknown; don't flash the banner on launch
  return (
    <Text
      style={[styles.banner, { paddingTop: insets.top + styles.banner.paddingVertical }]}
      accessibilityRole="alert"
    >
      Offline — showing cached data
    </Text>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#e67e22',
    color: '#fff',
    textAlign: 'center',
    paddingVertical: 6,
    fontWeight: '600',
  },
});
