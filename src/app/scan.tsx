import { useRef, useState } from 'react';
import { Button, Linking, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack } from 'expo-router';
import { resolveBarcode } from '../scan/resolveBarcode';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false); // onBarcodeScanned fires repeatedly; gate to one lookup

  async function onScanned({ data }: { data: string }) {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      const resolution = await resolveBarcode(data);
      if (resolution.kind === 'product') {
        router.replace(`/products/${resolution.id}`);
      } else {
        router.replace({ pathname: '/products/new', params: { barcode: resolution.barcode } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
      busyRef.current = false; // allow rescan after an error
    }
  }

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Stack.Screen options={{ title: 'Scan barcode' }} />
        <Text style={styles.permissionText}>
          Scanning needs camera access so it can read product barcodes.
        </Text>
        {permission.canAskAgain ? (
          <Button title="Allow camera" onPress={requestPermission} />
        ) : (
          <Button title="Open settings" onPress={() => Linking.openSettings()} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Scan barcode' }} />
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
        }}
        onBarcodeScanned={onScanned}
      />
      <View style={styles.overlay}>
        <Text style={styles.hint}>Point the camera at a barcode</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered: { justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16, backgroundColor: '#fff' },
  permissionText: { textAlign: 'center', fontSize: 16 },
  overlay: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', gap: 8 },
  hint: { color: '#fff', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  error: { color: '#ff7675', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
});
