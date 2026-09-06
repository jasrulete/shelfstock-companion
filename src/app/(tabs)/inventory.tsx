import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLowStock } from '../../api/analytics';
import { newRequestId, useAdjustStock, useProducts, useStockActivity } from '../../api/products';
import type { Product } from '../../api/types';
import { useDebouncedValue } from '../../useDebouncedValue';

export default function InventoryScreen() {
  const [search, setSearch] = useState('');
  // One request per pause in typing, not per keystroke (roadmap: 300 ms).
  const query = useDebouncedValue(search, 300);
  const { data, isLoading, isError, refetch, isRefetching } = useProducts(query);
  // Roadmap: chip only. It says how many, not which; the rows' red counts
  // say which, and a search finds them.
  const lowCount = useLowStock().data?.length ?? 0;

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
      {lowCount > 0 && (
        <View style={styles.chipRow}>
          <View style={styles.chip}>
            <Ionicons name="alert-circle-outline" size={14} color="#c0392b" />
            <Text style={styles.chipText}>{lowCount} low on stock</Text>
          </View>
        </View>
      )}
      {isError && (
        <View style={styles.errorBar} accessibilityRole="alert">
          <Text style={styles.errorText}>Couldn&apos;t load products.</Text>
          <Pressable accessibilityRole="button" onPress={() => refetch()} style={styles.retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        data={data?.products ?? []}
        keyExtractor={(p) => String(p.id)}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        // A failed load is not an empty shelf; the bar above says what happened.
        ListEmptyComponent={isLoading || isError ? null : <Text style={styles.empty}>No products</Text>}
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
  const adjust = useAdjustStock(product.id);
  const { pendingDelta, refusal } = useStockActivity(product.id);
  // The projected count: what the shelf will read once every queued press
  // lands. The cached count is the server's, and includes none of them.
  const projected = product.stock + pendingDelta;

  // Haptics are fire-and-forget. A device without a motor rejects the call,
  // and that must never surface as a failure on a stock change that succeeded.
  // The error buzz lives in adjustStockOptions, so a press refused on replay
  // buzzes too.
  const step = (delta: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    adjust.mutate({ id: product.id, delta, requestId: newRequestId() });
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
          {/* Always the server's number. A press it has not confirmed is drawn
              beside it, never folded into it, so a list restored from disk
              cannot claim a count the server never sent. */}
          <Text style={[styles.stock, low && styles.lowStock]}>{product.stock} in stock</Text>
          {pendingDelta !== 0 && (
            <Text style={styles.pending}>{`${pendingDelta > 0 ? '+' : ''}${pendingDelta} pending`}</Text>
          )}
          {/* A 409 names the count it refused against; once the count has moved
              on, the notice has nothing left to say. */}
          {refusal && (refusal.stock === null || refusal.stock === product.stock) && (
            <Text style={styles.refused} accessibilityRole="alert">
              {`${refusal.refused ? 'Refused' : 'Not applied'}: ${refusal.message}`}
            </Text>
          )}
        </View>
      </Pressable>
      {/* 48dp targets: this is pressed with a thumb while holding a box. A
          paused press holds nothing up - the next one queues behind it. The
          minus button gates on the projected count so a run of queued -1s
          never asks the server for one it will refuse. */}
      <View style={styles.stepper}>
        <StepButton
          icon="remove"
          label={`Decrease stock of ${product.name}`}
          disabled={projected <= 0}
          onPress={() => step(-1)}
        />
        <StepButton
          icon="add"
          label={`Increase stock of ${product.name}`}
          disabled={false}
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
  pending: { color: '#2c3e50', fontSize: 12, fontWeight: '600' },
  refused: { color: '#c0392b', fontSize: 12, textAlign: 'right', maxWidth: 170 },
  stepper: { flexDirection: 'row', paddingRight: 6 },
  stepButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  stepDisabled: { opacity: 0.4 },
  stepPressed: { backgroundColor: '#eee' },
  empty: { textAlign: 'center', marginTop: 40, color: '#666' },
  chipRow: { paddingHorizontal: 12, paddingBottom: 8 },
  chip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fdecea', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { color: '#c0392b', fontWeight: '600', fontSize: 12 },
  errorBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fdecea', paddingHorizontal: 12, paddingVertical: 8 },
  errorText: { color: '#c0392b', fontWeight: '600' },
  retry: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#c0392b' },
  retryText: { color: '#fff', fontWeight: '600' },
  fab: { position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center', elevation: 4 },
});
