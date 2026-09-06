import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
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

  onlineManager.setOnline(true);
  await done;
  await waitFor(() => expect(screen.queryByText(/queued/)).toBeNull());
});
