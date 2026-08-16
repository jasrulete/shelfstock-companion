import { Alert } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCreateProduct } from '../../api/products';
import ProductForm from '../../products/ProductForm';
import RequireAuth from '../../auth/RequireAuth';

export default function NewProductScreen() {
  return (
    <RequireAuth>
      <NewProductContent />
    </RequireAuth>
  );
}

function NewProductContent() {
  const { barcode } = useLocalSearchParams<{ barcode?: string }>();
  const mutation = useCreateProduct();

  return (
    <>
      <Stack.Screen options={{ title: 'New product' }} />
      <ProductForm
        initial={{ barcode: barcode ?? null }}
        submitLabel="Create product"
        busy={mutation.isPending}
        onSubmit={(input) =>
          mutation.mutate(input, {
            onSuccess: (created) => router.replace(`/products/${created.id}`),
            onError: (err) => Alert.alert('Create failed', (err as Error).message),
          })
        }
      />
    </>
  );
}
