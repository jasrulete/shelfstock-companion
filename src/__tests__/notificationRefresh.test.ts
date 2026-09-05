import { coerceOrderId, wireNotificationRefresh } from '../notificationRefresh';

describe('coerceOrderId', () => {
  // An unvalidated value straight from a push payload into router.push was
  // the actual defect (Roadmap 3.3). Only a positive integer opens an order.
  it.each([
    [{ orderId: 12 }, 12],
    [{ orderId: '12' }, 12],
    [{ orderId: '12abc' }, null],
    [{ orderId: -1 }, null],
    [{ orderId: 0 }, null],
    [{ orderId: 1.5 }, null],
    [{ orderId: '/orders/1' }, null],
    [{ orderId: '../admin' }, null],
    // Number() would happily accept these; the digits-only check is what refuses them.
    [{ orderId: '0x10' }, null],
    [{ orderId: '1e3' }, null],
    [{ orderId: ' 12 ' }, null],
    [{}, null],
    [undefined, null],
    [null, null],
  ])('%j -> %j', (data, expected) => {
    expect(coerceOrderId(data)).toBe(expected);
  });
});

describe('wireNotificationRefresh', () => {
  type Listener = (event: unknown) => void;
  let received: Listener;
  let responded: Listener;
  let appState: (state: string) => void;

  const removes = { received: jest.fn(), responded: jest.fn(), appState: jest.fn() };
  const notifications = {
    addNotificationReceivedListener: jest.fn((cb: Listener) => {
      received = cb;
      return { remove: removes.received };
    }),
    addNotificationResponseReceivedListener: jest.fn((cb: Listener) => {
      responded = cb;
      return { remove: removes.responded };
    }),
  };
  const appStateApi = {
    addEventListener: jest.fn((_type: string, cb: (state: string) => void) => {
      appState = cb;
      return { remove: removes.appState };
    }),
  };
  const queryClient = { invalidateQueries: jest.fn() };
  const router = { push: jest.fn() };
  const focusManager = { setFocused: jest.fn() };

  const wire = () =>
    wireNotificationRefresh({ notifications, appState: appStateApi, queryClient, router, focusManager });

  const tap = (data: unknown) => responded({ notification: { request: { content: { data } } } });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a tapped notification opens the order only when its id is sane', () => {
    wire();

    tap({ orderId: '7' });
    expect(router.push).toHaveBeenCalledWith('/orders/7');

    tap({ orderId: '../admin' });
    tap({});
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('a burst of foreground arrivals refetches the order list once', () => {
    wire();

    received({});
    received({});
    received({});
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    jest.advanceTimersByTime(600);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['orders'] });
  });

  it('tells TanStack when the app is in front, so stale queries refetch on return', () => {
    wire();

    appState('background');
    expect(focusManager.setFocused).toHaveBeenLastCalledWith(false);
    appState('active');
    expect(focusManager.setFocused).toHaveBeenLastCalledWith(true);
  });

  it('unsubscribes everything, and a pending refetch dies with it', () => {
    const off = wire();
    received({});
    off();

    expect(removes.received).toHaveBeenCalled();
    expect(removes.responded).toHaveBeenCalled();
    expect(removes.appState).toHaveBeenCalled();
    jest.advanceTimersByTime(600);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});
