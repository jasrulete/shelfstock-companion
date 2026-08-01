import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useOrders } from '../../api/orders';
import type { OrderListItem, OrderStatus } from '../../api/types';

const FILTERS: (OrderStatus | 'all')[] = ['all', 'pending', 'shipped', 'completed', 'cancelled'];

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: '#e67e22',
  shipped: '#2980b9',
  completed: '#27ae60',
  cancelled: '#7f8c8d',
};

export default function OrdersScreen() {
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const { data, isLoading, isError, error, refetch, isRefetching } = useOrders(
    filter === 'all' ? undefined : filter
  );

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      {isError && <Text style={styles.error}>{(error as Error).message}</Text>}
      <FlatList
        data={data?.orders ?? []}
        keyExtractor={(o) => String(o.id)}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          isLoading ? null : <Text style={styles.empty}>No orders{filter !== 'all' ? ` (${filter})` : ''}</Text>
        }
        renderItem={({ item }) => <OrderRow order={item} />}
      />
    </View>
  );
}

function OrderRow({ order }: { order: OrderListItem }) {
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/orders/${order.id}`)}>
      <View style={styles.rowTop}>
        <Text style={styles.orderId}>#{order.id}</Text>
        <Text style={[styles.status, { color: STATUS_COLORS[order.status] }]}>{order.status}</Text>
      </View>
      <Text style={styles.email}>{order.user_email}</Text>
      <View style={styles.rowTop}>
        <Text>${order.total_amount}</Text>
        <Text style={styles.date}>{new Date(order.created_at).toLocaleDateString()}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: '#111', borderColor: '#111' },
  chipText: { color: '#333' },
  chipTextActive: { color: '#fff' },
  row: { padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd', gap: 4 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between' },
  orderId: { fontWeight: '700' },
  status: { fontWeight: '600', textTransform: 'capitalize' },
  email: { color: '#666' },
  date: { color: '#666' },
  empty: { textAlign: 'center', marginTop: 40, color: '#666' },
  error: { color: '#c0392b', paddingHorizontal: 14 },
});
