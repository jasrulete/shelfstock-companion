import { StyleSheet, Text } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';

export default function OfflineBanner() {
  const { isConnected } = useNetInfo();
  if (isConnected !== false) return null; // null = unknown; don't flash the banner on launch
  return <Text style={styles.banner}>Offline — showing cached data</Text>;
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
