import { ActivityIndicator, Alert, Text } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useProduct, useUpdateProduct } from '../../api/products';
import ProductForm from '../../products/ProductForm';
import RequireAuth from '../../auth/RequireAuth';

export default function EditProductScreen() {
  return (
    <RequireAuth>
      <EditProductContent />
    </RequireAuth>
  );
}

function EditProductContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = Number(id);
  const { data: product, isLoading, isError, error } = useProduct(productId);
  const mutation = useUpdateProduct();

  if (isLoading) return <ActivityIndicator style={{ marginTop: 60 }} />;
  if (isError || !product)
    return <Text style={{ marginTop: 60, textAlign: 'center' }}>{(error as Error)?.message ?? 'Not found'}</Text>;

  return (
    <>
      <Stack.Screen options={{ title: product.name }} />
      <ProductForm
        initial={{
          name: product.name,
          description: product.description,
          price: Number(product.price),
          category: product.category,
          stock: product.stock,
          image_url: product.image_url,
          barcode: product.barcode,
        }}
        submitLabel="Save changes"
        busy={mutation.isPending}
        onSubmit={(input) =>
          mutation.mutate(
            { id: productId, ...input },
            {
              onSuccess: () => router.back(),
              onError: (err) => Alert.alert('Save failed', (err as Error).message),
            }
          )
        }
      />
    </>
  );
}
