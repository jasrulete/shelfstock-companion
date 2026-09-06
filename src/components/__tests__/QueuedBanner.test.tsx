import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import QueuedBanner from '../QueuedBanner';

afterEach(() => {
  onlineManager.setOnline(true);
});

it('says a change is queued while offline, and clears once it has been sent', async () => {
  onlineManager.setOnline(false);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <QueuedBanner />
    </QueryClientProvider>
  );
  expect(screen.queryByText(/queued/)).toBeNull();

  const mutation = client
    .getMutationCache()
    .build(client, { mutationKey: ['order-status'], mutationFn: async () => ({}) });
  const done = mutation.execute({ id: 5, status: 'shipped' });

  expect(await screen.findByText("1 queued — sends when you're back online")).toBeTruthy();

  await act(async () => onlineManager.setOnline(true));
  await done;
  await waitFor(() => expect(screen.queryByText(/queued/)).toBeNull());
});

it('says nothing about the network for a press waiting its turn behind another while online, until the network drops', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <QueuedBanner />
    </QueryClientProvider>
  );
  const build = () =>
    client.getMutationCache().build(client, {
      mutationKey: ['adjust-stock'],
      scope: { id: 'stock:1' },
      mutationFn: () => new Promise(() => {}),
    });
  const first = build();
  const second = build();
  void first.execute({ id: 1, delta: 1 }).catch(() => {});
  void second.execute({ id: 1, delta: 1 }).catch(() => {});
  await waitFor(() => expect(second.state.isPaused).toBe(true));

  // Paused, yes - but waiting for its turn, not for the network.
  expect(screen.queryByText(/queued/)).toBeNull();

  await act(async () => onlineManager.setOnline(false));
  expect(await screen.findByText("1 queued — sends when you're back online")).toBeTruthy();
});
