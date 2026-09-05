import { applyScan, initialPack, isFullyPacked, unverifiedLines } from '../packState';
import type { OrderItem } from '../../api/types';

function item(over: Partial<OrderItem> & { id: number }): OrderItem {
  return {
    order_id: 9,
    product_id: over.id + 100,
    quantity: 1,
    price_at_purchase: '1.00',
    product_name: `Item ${over.id}`,
    barcode: `20000000000${over.id}${over.id}`,
    ...over,
  };
}

const MUG = item({ id: 1, product_name: 'Mug', quantity: 2, barcode: '2000000000060' });
const PEN = item({ id: 2, product_name: 'Pen', quantity: 1, barcode: '2000000000077' });
const UNLABELLED = item({ id: 3, product_name: 'Unlabelled', quantity: 1, barcode: null });

/**
 * Roadmap 3.5. Point the camera at each product as you pack: lines tick off,
 * a wrong code is refused, and "Mark shipped" unlocks only once the box
 * matches the order. This is that logic with the camera taken out.
 */
describe('pack state', () => {
  it('starts with nothing scanned, and is not packed', () => {
    const state = initialPack([MUG, PEN]);
    expect(state.lines.map((l) => [l.name, l.scanned, l.expected])).toEqual([
      ['Mug', 0, 2],
      ['Pen', 0, 1],
    ]);
    expect(isFullyPacked(state)).toBe(false);
  });

  it('a matching scan ticks the line, and the line completes at its quantity', () => {
    let state = initialPack([MUG, PEN]);

    const first = applyScan(state, '2000000000060');
    expect(first.result).toBe('matched');
    expect(first.line?.name).toBe('Mug');
    state = first.state;
    expect(state.lines[0].scanned).toBe(1);

    const second = applyScan(state, '2000000000060');
    expect(second.result).toBe('line-complete');
    expect(second.state.lines[0].scanned).toBe(2);
  });

  it('refuses a scan beyond the quantity, and does not count it', () => {
    let state = initialPack([MUG]);
    state = applyScan(state, '2000000000060').state;
    state = applyScan(state, '2000000000060').state;

    const extra = applyScan(state, '2000000000060');
    expect(extra.result).toBe('already-full');
    expect(extra.state.lines[0].scanned).toBe(2);
  });

  it('refuses a code that is not in this order', () => {
    const state = initialPack([MUG, PEN]);
    const wrong = applyScan(state, '4006381333931');
    expect(wrong.result).toBe('unknown');
    expect(wrong.state).toBe(state);
  });

  it('does not mutate the previous state', () => {
    const state = initialPack([MUG]);
    applyScan(state, '2000000000060');
    expect(state.lines[0].scanned).toBe(0);
  });

  it('is fully packed only when every line is at quantity', () => {
    let state = initialPack([MUG, PEN]);
    state = applyScan(state, '2000000000060').state;
    state = applyScan(state, '2000000000060').state;
    expect(isFullyPacked(state)).toBe(false);
    state = applyScan(state, '2000000000077').state;
    expect(isFullyPacked(state)).toBe(true);
    expect(unverifiedLines(state)).toEqual([]);
  });

  it('a line without a barcode can never be verified by scanning, so the box is never fully packed', () => {
    let state = initialPack([MUG, UNLABELLED]);
    state = applyScan(state, '2000000000060').state;
    state = applyScan(state, '2000000000060').state;

    expect(isFullyPacked(state)).toBe(false);
    expect(unverifiedLines(state).map((l) => l.name)).toEqual(['Unlabelled']);
    // The only way out is the explicit "Ship anyway" override on the screen.
  });

  it('with the same product on two lines, a scan fills the first line that still has room', () => {
    const again = item({ id: 4, product_name: 'Mug', quantity: 1, barcode: '2000000000060' });
    let state = initialPack([MUG, again]);
    for (let i = 0; i < 3; i++) state = applyScan(state, '2000000000060').state;

    expect(state.lines.map((l) => l.scanned)).toEqual([2, 1]);
    expect(isFullyPacked(state)).toBe(true);
  });
});
