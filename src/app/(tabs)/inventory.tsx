import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAdjustStock, useProducts } from '../../api/products';
import type { Product } from '../../api/types';

export default function InventoryScreen() {
  const [search, setSearch] = useState('');
  const { data, isLoading, refetch, isRefetching } = useProducts(search);

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          placeholder="Search products"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        <Pressable style={styles.scanButton} onPress={() => router.push('/scan')} accessibilityLabel="Scan barcode">
          <Ionicons name="barcode-outline" size={22} color="#fff" />
          <Text style={styles.scanText}>Scan</Text>
        </Pressable>
      </View>
      <FlatList
        data={data?.products ?? []}
        keyExtractor={(p) => String(p.id)}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={isLoading ? null : <Text style={styles.empty}>No products</Text>}
        renderItem={({ item }) => <ProductRow product={item} />}
      />
      <Pressable style={styles.fab} onPress={() => router.push('/products/new')} accessibilityLabel="Add product">
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

function ProductRow({ product }: { product: Product }) {
  const low = product.stock <= 5;
  const adjust = useAdjustStock();

  // Haptics are fire-and-forget. A device without a motor rejects the call,
  // and that must never surface as a failure on a stock change that succeeded.
  const step = (delta: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    adjust.mutate(
      { id: product.id, delta },
      {
        onError: () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        },
      }
    );
  };

  return (
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={() => router.push(`/products/${product.id}`)}>
        <View style={styles.rowText}>
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.category}>{product.category}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text>${product.price}</Text>
          <Text style={[styles.stock, low && styles.lowStock]}>{product.stock} in stock</Text>
        </View>
      </Pressable>
      {/* 48dp targets: this is pressed with a thumb while holding a box. */}
      <View style={styles.stepper}>
        <StepButton
          icon="remove"
          label={`Decrease stock of ${product.name}`}
          disabled={product.stock <= 0 || adjust.isPending}
          onPress={() => step(-1)}
        />
        <StepButton
          icon="add"
          label={`Increase stock of ${product.name}`}
          disabled={adjust.isPending}
          onPress={() => step(1)}
        />
      </View>
    </View>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'add' | 'remove';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.stepButton, disabled && styles.stepDisabled, pressed && styles.stepPressed]}
    >
      <Ionicons name={icon} size={22} color={disabled ? '#bbb' : '#111'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: { flexDirection: 'row', gap: 8, padding: 12 },
  search: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  scanButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 12 },
  scanText: { color: '#fff', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  rowMain: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
  rowText: { flexShrink: 1, paddingRight: 8 },
  name: { fontWeight: '600' },
  category: { color: '#666', fontSize: 12 },
  rowRight: { alignItems: 'flex-end' },
  stock: { color: '#666', fontSize: 12 },
  lowStock: { color: '#c0392b', fontWeight: '700' },
  stepper: { flexDirection: 'row', paddingRight: 6 },
  stepButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  stepDisabled: { opacity: 0.4 },
  stepPressed: { backgroundColor: '#eee' },
  empty: { textAlign: 'center', marginTop: 40, color: '#666' },
  fab: { position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center', elevation: 4 },
});
