import {
  keepPreviousData,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { api, ApiError } from './client';
import type { Product, ProductsListResponse, StockAdjustment } from './types';

export interface ProductInput {
  name: string;
  description?: string | null;
  price: number;
  category: string;
  stock?: number;
  image_url?: string | null;
  barcode?: string | null;
}

export function useProducts(search: string) {
  return useQuery({
    queryKey: ['products', search],
    // A new search keeps the last list on screen until its own arrives,
    // instead of flashing empty between keystrokes.
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<ProductsListResponse>(
        `/api/products?limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`
      ),
  });
}

export function useProduct(id: number) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: () => api<Product>(`/api/products/${id}`),
    enabled: Number.isFinite(id),
  });
}

export function lookupBarcode(code: string): Promise<Product> {
  return api<Product>(`/api/products/barcode/${encodeURIComponent(code)}`);
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) =>
      api<Product>('/api/products', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });
}

/** Plain function for the same reason as updateOrderStatus: the ['product'] mutation default. */
export function updateProduct({ id, ...input }: Partial<ProductInput> & { id: number }): Promise<Product> {
  return api<Product>(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['product'],
    mutationFn: updateProduct,
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product', id] });
    },
  });
}

export interface AdjustStockInput {
  id: number;
  delta: number;
  /**
   * One id per press, made when the button is pressed, persisted with the
   * mutation and sent with every attempt. The persister's write to disk lags
   * the live state by up to its throttle, so an app killed in that window
   * after a reconnect replays a press that already landed; the server dedupes
   * on this id and answers with the row it already wrote.
   */
  requestId: string;
  note?: string;
}

/**
 * Not a UUID - there is no expo-crypto here - but the time plus twelve random
 * base-36 characters is far beyond the collision odds of a hand-pressed queue.
 * Lives outside any component so the React Compiler sees no clock in render.
 */
export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export interface AdjustStockResponse {
  stock: number;
  adjustment: StockAdjustment;
}

/**
 * Moves a product's stock by a delta through POST /adjust-stock, which the
 * server applies atomically while holding the row. The alternative - read the
 * count, add one, PUT it back - silently swallows any order that decremented
 * the same product between the read and the write, and that is a worse bug
 * than the ergonomics problem a stepper solves.
 *
 * A plain function, like updateOrderStatus and updateProduct: offline.ts
 * registers it as the default for the ['adjust-stock'] key, so a press that
 * was still queued when the app closed can run on the next launch.
 */
export function adjustStock({ id, delta, requestId, note }: AdjustStockInput): Promise<AdjustStockResponse> {
  return api<AdjustStockResponse>(`/api/products/${id}/adjust-stock`, {
    method: 'POST',
    body: JSON.stringify({ delta, source: 'companion', requestId, ...(note ? { note } : {}) }),
  });
}

/**
 * The count a 409 from adjust-stock refused against - the server answers
 * `{ error, stock }` (routes/products.ts) so the client can show it - or null
 * for any other failure.
 */
function refusedStock(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const stock = (err.body as { stock?: unknown } | undefined)?.stock;
  return typeof stock === 'number' ? stock : null;
}

/** The server's number, and only the server's: every cached list row and the detail query. */
function setStock(client: QueryClient, id: number, stock: number) {
  client.setQueriesData<ProductsListResponse>({ queryKey: ['products'] }, (old) =>
    old ? { ...old, products: old.products.map((p) => (p.id === id ? { ...p, stock } : p)) } : old
  );
  client.setQueryData<Product>(['product', id], (old) => (old ? { ...old, stock } : old));
}

/** This product's presses the server has not answered yet, the calling one included while its callbacks run. */
function pendingPresses(client: QueryClient, id: number) {
  return client.getMutationCache().findAll({
    mutationKey: ['adjust-stock'],
    status: 'pending',
    predicate: (m) => (m.state.variables as AdjustStockInput | undefined)?.id === id,
  });
}

/**
 * Deliberately not awaited: the mutation stays pending until its callbacks
 * settle, and while it is pending the row still draws its delta. Awaiting a
 * refetch here would show the count and the delta for the whole round trip.
 *
 * And held back while more presses for this product are still queued: a
 * refetch landing between two presses shows a count the next press is about
 * to move. The last press of the run refetches for all of them.
 */
function refreshStock(client: QueryClient, id: number) {
  if (pendingPresses(client, id).length > 1) return;
  void client.invalidateQueries({ queryKey: ['products'] });
  void client.invalidateQueries({ queryKey: ['product', id] });
  void client.invalidateQueries({ queryKey: ['low-stock'] }); // the inventory tab's chip counts from this
}

/**
 * The whole lifecycle of a stepper press, as plain options. useAdjustStock
 * spreads them and offline.ts registers them as the ['adjust-stock'] mutation
 * default, so a press restored from disk reconciles exactly like a live one.
 *
 * No onMutate, on purpose (C-INV-8). The row never carries a number the
 * server has not sent: a press that is not yet confirmed is drawn beside the
 * count by useStockActivity, never folded into it. That keeps the persisted
 * list honest across a relaunch, and it means nothing ever needs rolling
 * back. It matters more than it looks: hydration serialises a mutation's
 * state whole, context included, so an onMutate snapshot WOULD come back from
 * disk and roll every row to a stale count on a replayed 409. offline.test.ts
 * pins that the persisted context stays undefined.
 *
 * No retry either: adjust-stock has no idempotency key, so a request that
 * reached the server but lost its answer would double-write the ledger if it
 * were retried. A press lost that way shows as refused, and the refetch shows
 * the truth.
 */
export function adjustStockOptions(client: QueryClient) {
  return {
    mutationFn: adjustStock,
    // A refused press restored from disk has no observer, and the cache
    // collects an unobserved settled mutation after gcTime counted from when
    // it was built - so with the default five minutes its "Refused" text could
    // vanish seconds after appearing. An hour costs a few bytes each.
    gcTime: 60 * 60 * 1000,
    onSuccess: ({ stock }: AdjustStockResponse, { id }: AdjustStockInput) => {
      setStock(client, id, stock);
      refreshStock(client, id);
    },
    onError: (err: unknown, { id }: AdjustStockInput) => {
      // A 409 carries the count the server refused against; take it now
      // rather than wait for the refetch. Anything else: refetch, and let the
      // row say why.
      const refused = refusedStock(err);
      if (refused !== null) setStock(client, id, refused);
      refreshStock(client, id);
      // Here rather than on the row's mutate() call: that callback fires only
      // for the press the row still observes, and a press refused on replay
      // after a relaunch has no row observing it. Fire-and-forget - a device
      // without a motor rejects, and that must never surface as a failure.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    },
  };
}

export function useAdjustStock(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['adjust-stock'],
    // Presses on one product run one at a time, in press order: the second
    // waits (paused) until the first has settled. The scope is persisted with
    // the mutation, so a queue restored from disk keeps its order too.
    scope: { id: `stock:${id}` },
    ...adjustStockOptions(queryClient),
  });
}

export interface StockRefusal {
  /** The server's words for a 409; the error's message for anything else. */
  message: string;
  /** True for a 409 - the server refused the delta. False for a press that never got an answer. */
  refused: boolean;
  /** The count the 409 was refused against, so the notice can go once the count has moved on. */
  stock: number | null;
}

export interface StockActivity {
  /** Sum of the deltas of this product's presses the server has not confirmed yet. */
  pendingDelta: number;
  /** The newest failed press, unless a later press has since landed. */
  refusal: StockRefusal | null;
}

/**
 * What the mutation cache knows about a product that its count does not:
 * presses not yet confirmed (in flight, waiting their turn, offline, or
 * restored from disk) and the outcome of the newest one if it was refused.
 * The hook behind the buttons only ever follows the latest press; this sees
 * them all.
 */
export function useStockActivity(id: number): StockActivity {
  const presses = useMutationState({
    filters: {
      mutationKey: ['adjust-stock'],
      predicate: (m) => (m.state.variables as AdjustStockInput | undefined)?.id === id,
    },
    select: (m) => ({
      // mutationId is a strictly increasing ordinal; submittedAt is a
      // millisecond clock, and a double-tap ties on it.
      seq: m.mutationId,
      status: m.state.status,
      delta: (m.state.variables as AdjustStockInput | undefined)?.delta ?? 0,
      message: m.state.error instanceof Error ? m.state.error.message : null,
      refused: m.state.error instanceof ApiError && m.state.error.status === 409,
      refusedAgainst: refusedStock(m.state.error),
    }),
  });
  let pendingDelta = 0;
  let newestFailure: (typeof presses)[number] | undefined;
  let lastLanded = -1;
  for (const press of presses) {
    if (press.status === 'pending') pendingDelta += press.delta;
    if (press.status === 'success' && press.seq > lastLanded) lastLanded = press.seq;
    if (press.status === 'error' && (!newestFailure || press.seq > newestFailure.seq)) newestFailure = press;
  }
  // A failure is worth showing until a later press lands: after that the
  // count has moved on and the notice would only invite a second look at
  // a number that is already right.
  const refusal =
    newestFailure && newestFailure.seq > lastLanded && newestFailure.message
      ? { message: newestFailure.message, refused: newestFailure.refused, stock: newestFailure.refusedAgainst }
      : null;
  return { pendingDelta, refusal };
}
