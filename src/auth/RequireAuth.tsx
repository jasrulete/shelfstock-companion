import { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from './AuthContext';

// Guards non-tab screens (order/product detail, scan, ...) reachable via deep
// link — e.g. a push-notification tap — that could otherwise render and hit
// the API while logged out. Mirrors (tabs)/_layout.tsx's guard.
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;

  return <>{children}</>;
}
