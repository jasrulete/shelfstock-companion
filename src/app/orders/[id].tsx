import { ActivityIndicator, Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { statusActions, useOrder, useUpdateOrderStatus } from '../../api/orders';
import type { OrderStatus } from '../../api/types';

const ACTION_LABELS: Record<OrderStatus, string> = {
  pending: 'Mark pending',
  shipped: 'Mark shipped',
  completed: 'Mark completed',
  cancelled: 'Cancel order',
};

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);
  const { data: order, isLoading, isError, error } = useOrder(orderId);
  const mutation = useUpdateOrderStatus();

  function onAction(status: OrderStatus) {
    const run = () =>
      mutation.mutate(
        { id: orderId, status },
        { onError: (err) => Alert.alert('Update failed', (err as Error).message) }
      );
    if (status === 'cancelled') {
      // Cancelling restores stock and is terminal on the backend.
      Alert.alert('Cancel this order?', 'Stock will be restored. This cannot be undone.', [
        { text: 'Keep order', style: 'cancel' },
        { text: 'Cancel order', style: 'destructive', onPress: run },
      ]);
    } else {
      run();
    }
  }

  if (isLoading) return <ActivityIndicator style={styles.center} />;
  if (isError || !order)
    return <Text style={[styles.center, styles.error]}>{(error as Error)?.message ?? 'Not found'}</Text>;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: `Order #${order.id}` }} />
      <Text style={styles.status}>Status: {order.status}</Text>

      <Text style={styles.section}>Items</Text>
      {order.items.map((item) => (
        <View key={item.id} style={styles.itemRow}>
          <Text style={styles.itemName}>
            {item.quantity} × {item.product_name}
          </Text>
          <Text>${item.price_at_purchase}</Text>
        </View>
      ))}
      <View style={styles.itemRow}>
        <Text style={styles.total}>Total</Text>
        <Text style={styles.total}>${order.total_amount}</Text>
      </View>

      <Text style={styles.section}>Shipping</Text>
      <Text>{order.shipping_name}</Text>
      <Text>{order.shipping_phone}</Text>
      <Text>
        {order.shipping_address}, {order.shipping_city}
      </Text>

      <View style={styles.actions}>
        {statusActions(order.status).map((next) => (
          <Button
            key={next}
            title={ACTION_LABELS[next]}
            color={next === 'cancelled' ? '#c0392b' : undefined}
            disabled={mutation.isPending}
            onPress={() => onAction(next)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 6 },
  center: { flex: 1, marginTop: 60, textAlign: 'center' },
  error: { color: '#c0392b' },
  status: { fontSize: 16, fontWeight: '600', textTransform: 'capitalize' },
  section: { marginTop: 16, fontSize: 14, fontWeight: '700', color: '#666', textTransform: 'uppercase' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  itemName: { flexShrink: 1, paddingRight: 8 },
  total: { fontWeight: '700' },
  actions: { marginTop: 24, gap: 10 },
});
