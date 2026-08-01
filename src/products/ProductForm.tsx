import { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import type { ProductInput } from '../api/products';

interface Props {
  initial?: Partial<ProductInput>;
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: ProductInput) => void;
}

export default function ProductForm({ initial, submitLabel, busy, onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [price, setPrice] = useState(initial?.price != null ? String(initial.price) : '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [stock, setStock] = useState(initial?.stock != null ? String(initial.stock) : '0');
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? '');
  const [barcode, setBarcode] = useState(initial?.barcode ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const priceNum = Number(price);
    const stockNum = Number(stock);
    if (!name.trim()) return setError('Name is required');
    if (!Number.isFinite(priceNum) || priceNum < 0) return setError('Price must be a non-negative number');
    if (!category.trim()) return setError('Category is required');
    if (!Number.isInteger(stockNum) || stockNum < 0) return setError('Stock must be a whole number');
    setError(null);
    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      price: priceNum,
      category: category.trim(),
      stock: stockNum,
      image_url: imageUrl.trim() || null,
      barcode: barcode.trim() || null,
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} />
      <Text style={styles.label}>Description</Text>
      <TextInput style={[styles.input, styles.multiline]} value={description ?? ''} onChangeText={setDescription} multiline />
      <Text style={styles.label}>Price (USD)</Text>
      <TextInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
      <Text style={styles.label}>Category</Text>
      <TextInput style={styles.input} value={category} onChangeText={setCategory} />
      <Text style={styles.label}>Stock</Text>
      <TextInput style={styles.input} value={stock} onChangeText={setStock} keyboardType="number-pad" />
      <Text style={styles.label}>Image URL</Text>
      <TextInput style={styles.input} value={imageUrl ?? ''} onChangeText={setImageUrl} autoCapitalize="none" />
      <Text style={styles.label}>Barcode</Text>
      <TextInput style={styles.input} value={barcode ?? ''} onChangeText={setBarcode} autoCapitalize="none" />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={submitLabel} onPress={submit} disabled={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 6, paddingBottom: 40 },
  label: { fontWeight: '600', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  error: { color: '#c0392b', marginVertical: 8 },
});
