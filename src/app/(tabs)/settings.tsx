import { useEffect, useState } from 'react';
import { Button, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../auth/AuthContext';
import { disablePush, enablePush, getStoredPushToken } from '../../notifications';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const [pushOn, setPushOn] = useState(false);

  useEffect(() => {
    void getStoredPushToken().then((t) => setPushOn(!!t));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Signed in as</Text>
      <Text style={styles.email}>{user?.email}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Text style={{ fontSize: 16 }}>New-order notifications</Text>
        <Switch
          value={pushOn}
          onValueChange={async (next) => {
            setPushOn(next ? await enablePush() : (await disablePush(), false));
          }}
        />
      </View>
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
});
