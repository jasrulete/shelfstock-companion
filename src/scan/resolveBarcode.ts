import { ApiError } from '../api/client';
import { lookupBarcode } from '../api/products';

export type ScanResolution = { kind: 'product'; id: number } | { kind: 'new'; barcode: string };

// 404 is the one expected miss ("not in the catalog yet"); anything else
// is a real failure the screen should surface.
export async function resolveBarcode(code: string): Promise<ScanResolution> {
  try {
    const product = await lookupBarcode(code);
    return { kind: 'product', id: product.id };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { kind: 'new', barcode: code };
    }
    throw err;
  }
}
