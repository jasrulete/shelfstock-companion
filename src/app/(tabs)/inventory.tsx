import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useProducts } from '../../api/products';
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
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/products/${product.id}`)}>
      <View style={styles.rowText}>
        <Text style={styles.name}>{product.name}</Text>
        <Text style={styles.category}>{product.category}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text>${product.price}</Text>
        <Text style={[styles.stock, low && styles.lowStock]}>{product.stock} in stock</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: { flexDirection: 'row', gap: 8, padding: 12 },
  search: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  scanButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 12 },
  scanText: { color: '#fff', fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  rowText: { flexShrink: 1, paddingRight: 8 },
  name: { fontWeight: '600' },
  category: { color: '#666', fontSize: 12 },
  rowRight: { alignItems: 'flex-end' },
  stock: { color: '#666', fontSize: 12 },
  lowStock: { color: '#c0392b', fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 40, color: '#666' },
  fab: { position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center', elevation: 4 },
});
