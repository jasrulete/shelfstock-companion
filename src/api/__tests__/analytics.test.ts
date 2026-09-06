import { fetchLowStock } from '../analytics';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const fetchMock = jest.fn();
// @ts-expect-error global.fetch is assigned during tests
global.fetch = fetchMock as unknown as typeof fetch;

it('reads the admin analytics endpoint, not the public merchandising rail', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve([{ id: 2, name: 'Gadget', stock: 0 }]),
  });

  const rows = await fetchLowStock();

  expect(rows).toEqual([{ id: 2, name: 'Gadget', stock: 0 }]);
  expect(fetchMock.mock.calls[0][0]).toContain('/api/analytics/low-stock');
  expect(fetchMock.mock.calls[0][0]).not.toContain('/api/products/low-stock');
});
