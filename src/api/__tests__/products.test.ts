jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import { lookupBarcode } from '../products';

const fetchMock = jest.fn();
// @ts-expect-error global.fetch is assigned during tests
global.fetch = fetchMock as unknown as typeof fetch;

it('URL-encodes the barcode in the lookup path', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: 3, barcode: 'A B/1' }),
  });

  const product = await lookupBarcode('A B/1');

  expect(product.id).toBe(3);
  expect(fetchMock.mock.calls[0][0]).toContain('/api/products/barcode/A%20B%2F1');
});
