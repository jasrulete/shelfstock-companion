import { useEffect, useState } from 'react';
import { Alert, Button, Linking, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../auth/AuthContext';
import {
  disablePush,
  enablePush,
  getPushPermissionState,
  getStoredPushToken,
} from '../../notifications';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const [pushOn, setPushOn] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    void getStoredPushToken().then((t) => setPushOn(!!t));
    // 'blocked' is the one state the switch cannot fix: the OS will not ask
    // again, so the screen has to say so and point at system settings.
    void getPushPermissionState()
      .then((state) => setBlocked(state === 'blocked'))
      .catch(() => {});
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Signed in as</Text>
      <Text style={styles.email}>{user?.email}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ fontSize: 16 }}>New-order notifications</Text>
        <Switch
          accessibilityLabel="New-order notifications"
          value={pushOn}
          disabled={blocked}
          onValueChange={async (next) => {
            try {
              setPushOn(next ? await enablePush() : (await disablePush(), false));
            } catch (err) {
              setPushOn(false);
              Alert.alert('Could not update notifications', (err as Error).message);
            }
          }}
        />
      </View>
      {blocked ? (
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>
            Notifications are turned off for this app in system settings, so this switch cannot turn
            them on.
          </Text>
          <Button title="Open settings" onPress={() => Linking.openSettings()} />
        </View>
      ) : (
        <View style={{ marginBottom: 16 }} />
      )}
      <Button
        title="Log out"
        onPress={async () => {
          await logout();
          router.replace('/login');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  label: { color: '#666' },
  email: { fontSize: 16, fontWeight: '600', marginBottom: 24 },
  blocked: { gap: 8, marginBottom: 24, padding: 12, borderRadius: 8, backgroundColor: '#fff4e5' },
  blockedText: { color: '#8a6d3b' },
});
