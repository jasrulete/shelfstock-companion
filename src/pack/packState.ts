import type { OrderItem } from '../api/types';

/**
 * Scan-to-verify (Roadmap 3.5), with the camera taken out.
 *
 * Point the camera at each product as you pack. A scan that matches a line
 * ticks it; a line completes at its quantity; a scan of something not in the
 * order, or of a line already full, is refused. "Mark shipped" unlocks only
 * when the box matches the order - and a line whose product has no barcode
 * can never be verified by scanning, so it keeps the box from ever counting
 * as fully packed. The screen's explicit "Ship anyway" is the way past that,
 * on purpose: without it a single unlabelled product would block fulfilment.
 *
 * Pure and immutable: every call returns a new state and never touches the
 * one it was given, which is what lets the screen keep it in React state.
 */

export interface PackLine {
  itemId: number;
  productId: number;
  name: string;
  barcode: string | null;
  expected: number;
  scanned: number;
}

export interface PackState {
  lines: PackLine[];
}

export type ScanResult = 'matched' | 'line-complete' | 'already-full' | 'unknown';

export function initialPack(items: OrderItem[]): PackState {
  return {
    lines: items.map((item) => ({
      itemId: item.id,
      productId: item.product_id,
      name: item.product_name,
      barcode: item.barcode ?? null,
      expected: item.quantity,
      scanned: 0,
    })),
  };
}

export function applyScan(
  state: PackState,
  code: string
): { state: PackState; result: ScanResult; line?: PackLine } {
  const matching = state.lines.filter((line) => line.barcode !== null && line.barcode === code);
  if (matching.length === 0) return { state, result: 'unknown' };

  // The same product can appear on more than one line; fill the first that
  // still has room.
  const target = matching.find((line) => line.scanned < line.expected);
  if (!target) return { state, result: 'already-full', line: matching[0] };

  const updated: PackLine = { ...target, scanned: target.scanned + 1 };
  return {
    state: { lines: state.lines.map((line) => (line === target ? updated : line)) },
    result: updated.scanned === updated.expected ? 'line-complete' : 'matched',
    line: updated,
  };
}

/**
 * Every line verified by scanning. A line with no barcode can never be
 * scanned - applyScan matches on the code, and null matches nothing - so its
 * count never moves and it keeps this false. That is what makes "Ship anyway"
 * the only way to ship a box containing one; no extra check is needed here.
 */
export function isFullyPacked(state: PackState): boolean {
  return state.lines.every((line) => line.scanned >= line.expected);
}

/** The lines "Ship anyway" would be shipping unverified, including any with no barcode. */
export function unverifiedLines(state: PackState): PackLine[] {
  return state.lines.filter((line) => line.scanned < line.expected);
}
