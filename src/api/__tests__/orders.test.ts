import { statusActions } from '../orders';

describe('statusActions', () => {
  it('pending can ship or cancel', () => {
    expect(statusActions('pending')).toEqual(['shipped', 'cancelled']);
  });
  it('shipped can complete or cancel', () => {
    expect(statusActions('shipped')).toEqual(['completed', 'cancelled']);
  });
  it('terminal states offer nothing', () => {
    expect(statusActions('completed')).toEqual([]);
    expect(statusActions('cancelled')).toEqual([]);
  });
});
