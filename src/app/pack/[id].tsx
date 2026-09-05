import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Button, Linking, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useOrder, useUpdateOrderStatus } from '../../api/orders';
import RequireAuth from '../../auth/RequireAuth';
import {
  applyScan,
  initialPack,
  isFullyPacked,
  unverifiedLines,
  type PackLine,
  type PackState,
  type ScanResult,
} from '../../pack/packState';

/**
 * Pack & verify (Roadmap 3.5). Point the camera at each product as you pack:
 * lines tick off green, a wrong code buzzes and is refused, and "Mark shipped"
 * unlocks only once the box matches the order. "Ship anyway" is the explicit
 * override - without it, one product with no barcode would block fulfilment
 * - and it tells the server what it skipped.
 */
export default function PackScreen() {
  return (
    <RequireAuth>
      <PackContent />
    </RequireAuth>
  );
}

const SAME_CODE_COOLDOWN_MS = 1500;

/**
 * The camera reports the same code many times a second while it is in view;
 * one physical scan is one tick. Kept outside the component so the clock is
 * read in the scan callback and nowhere near render.
 */
function makeScanGate(cooldownMs: number) {
  let last = { code: '', at: 0 };
  return (code: string): boolean => {
    const now = Date.now();
    if (code === last.code && now - last.at < cooldownMs) return false;
    last = { code, at: now };
    return true;
  };
}

interface Flash {
  tone: 'ok' | 'bad';
  text: string;
}

/** What the screen owns: the pack so far (null until the first scan) and the last outcome. */
interface ScanState {
  pack: PackState | null;
  flash: Flash | null;
}

function flashFor(result: ScanResult, line?: PackLine): Flash {
  if (result === 'matched' || result === 'line-complete') {
    return { tone: 'ok', text: `${line!.name} — ${line!.scanned} of ${line!.expected}` };
  }
  if (result === 'already-full') return { tone: 'bad', text: `${line!.name} is already fully scanned` };
  return { tone: 'bad', text: 'Not in this order' };
}

function PackContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);
  const { data: order, isLoading, isError, error } = useOrder(orderId);
  const mutation = useUpdateOrderStatus();
  const [permission, requestPermission] = useCameraPermissions();
  const [gate] = useState(() => makeScanGate(SAME_CODE_COOLDOWN_MS));
  const [scan, setScan] = useState<ScanState>({ pack: null, flash: null });

  // Haptics are an external system, so they belong in an effect keyed on the
  // outcome - a new Flash object per scan, even for the same text.
  useEffect(() => {
    if (!scan.flash) return;
    const kind =
      scan.flash.tone === 'ok'
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error;
    void Haptics.notificationAsync(kind).catch(() => {});
  }, [scan.flash]);

  // Until the first scan the pack is derived from the order, not stored:
  // there is nothing to remember yet, and it keeps this component free of a
  // "set state when the query lands" effect.
  const pack = scan.pack ?? (order ? initialPack(order.items) : null);

  function onScanned({ data }: { data: string }) {
    if (!gate(data)) return;
    setScan((prev) => {
      const base = prev.pack ?? (order ? initialPack(order.items) : null);
      if (!base) return prev;
      const { state, result, line } = applyScan(base, data);
      return { pack: state, flash: flashFor(result, line) };
    });
  }

  function ship(note?: string) {
    mutation.mutate(
      { id: orderId, status: 'shipped', note },
      {
        onSuccess: () => router.replace(`/orders/${orderId}`),
        onError: (err) => Alert.alert('Update failed', (err as Error).message),
      }
    );
  }

  function shipAnyway() {
    if (!pack) return;
    const skipped = unverifiedLines(pack);
    Alert.alert(
      'Ship without verifying?',
      `${skipped.length} of ${pack.lines.length} line(s) were not scanned.`,
      [
        { text: 'Keep packing', style: 'cancel' },
        {
          text: 'Ship anyway',
          style: 'destructive',
          onPress: () => ship(`Shipped with ${skipped.length} of ${pack.lines.length} lines unverified`),
        },
      ]
    );
  }

  if (isLoading || !permission) return <ActivityIndicator style={styles.center} />;
  if (isError || !order)
    return <Text style={[styles.center, styles.error]}>{(error as Error)?.message ?? 'Not found'}</Text>;

  if (order.status !== 'pending') {
    return (
      <View style={[styles.container, styles.padded]}>
        <Stack.Screen options={{ title: `Pack order #${order.id}` }} />
        <Text style={styles.note}>This order is {order.status}; there is nothing to pack.</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.padded, styles.centered]}>
        <Stack.Screen options={{ title: `Pack order #${order.id}` }} />
        <Text style={styles.note}>Verifying a box needs the camera to read product barcodes.</Text>
        {permission.canAskAgain ? (
          <Button title="Allow camera" onPress={requestPermission} />
        ) : (
          <Button title="Open settings" onPress={() => Linking.openSettings()} />
        )}
      </View>
    );
  }

  const packed = pack ? isFullyPacked(pack) : false;
  const unverified = pack ? unverifiedLines(pack).length : 0;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `Pack order #${order.id}` }} />

      <View style={styles.lines}>
        {pack?.lines.map((line) => {
          const done = line.scanned >= line.expected;
          return (
            <View
              key={line.itemId}
              style={styles.line}
              accessibilityLabel={`${line.name}, ${line.scanned} of ${line.expected}`}
            >
              <Text style={[styles.lineName, done && styles.lineDone]}>
                {done ? '✓ ' : ''}
                {line.name}
              </Text>
              <Text style={[styles.lineCount, done && styles.lineDone]}>
                {line.barcode === null ? 'no barcode' : `${line.scanned} / ${line.expected}`}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.camera}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{
            barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
          }}
          onBarcodeScanned={onScanned}
        />
        {scan.flash && (
          <View style={[styles.flash, scan.flash.tone === 'ok' ? styles.flashOk : styles.flashBad]}>
            <Text style={styles.flashText}>{scan.flash.text}</Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        {packed ? (
          <Button title="Mark shipped" disabled={mutation.isPending} onPress={() => ship()} />
        ) : (
          <Button
            title={`Ship anyway (${unverified} unverified)`}
            color="#c0392b"
            disabled={mutation.isPending}
            onPress={shipAnyway}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  padded: { padding: 16 },
  centered: { justifyContent: 'center', alignItems: 'center', gap: 16 },
  center: { flex: 1, marginTop: 60, textAlign: 'center' },
  error: { color: '#c0392b' },
  note: { textAlign: 'center', fontSize: 16 },
  lines: { paddingHorizontal: 16, paddingVertical: 8, gap: 4 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  lineName: { flexShrink: 1, paddingRight: 8, fontWeight: '600' },
  lineCount: { color: '#666', fontVariant: ['tabular-nums'] },
  lineDone: { color: '#1e8449' },
  camera: { flex: 1, backgroundColor: '#000' },
  flash: { position: 'absolute', bottom: 16, left: 16, right: 16, borderRadius: 8, padding: 12 },
  flashOk: { backgroundColor: 'rgba(30,132,73,0.9)' },
  flashBad: { backgroundColor: 'rgba(192,57,43,0.9)' },
  flashText: { color: '#fff', textAlign: 'center', fontWeight: '600' },
  actions: { padding: 16 },
});
