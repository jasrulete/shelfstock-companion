jest.mock('../../api/products', () => ({ lookupBarcode: jest.fn() }));

import { lookupBarcode } from '../../api/products';
import { ApiError } from '../../api/client';
import { resolveBarcode } from '../resolveBarcode';

const lookupMock = lookupBarcode as jest.Mock;

beforeEach(() => jest.clearAllMocks());

it('routes to the product when the barcode is known', async () => {
  lookupMock.mockResolvedValueOnce({ id: 9 });
  await expect(resolveBarcode('123')).resolves.toEqual({ kind: 'product', id: 9 });
});

it('routes to create-product when the barcode is unknown (404)', async () => {
  lookupMock.mockRejectedValueOnce(new ApiError(404, 'No product with this barcode'));
  await expect(resolveBarcode('123')).resolves.toEqual({ kind: 'new', barcode: '123' });
});

it('rethrows non-404 errors', async () => {
  lookupMock.mockRejectedValueOnce(new ApiError(500, 'boom'));
  await expect(resolveBarcode('123')).rejects.toMatchObject({ status: 500 });
});
