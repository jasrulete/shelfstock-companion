# ShelfStock Companion v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A React Native (Expo) admin app for ShelfStock — order management with push notifications and barcode-scan inventory — plus the small additive backend endpoints it needs.

**Architecture:** Two codebases. Phase A adds additive endpoints to the existing Express + PostgreSQL API in the `shelfstock` repo (barcode lookup, device-token registration, Expo push on new orders). Phase B builds the Expo app in this repo as a pure API client: Expo Router screens, TanStack Query for server state with offline read caching, SecureStore for the JWT.

**Tech Stack:** Backend: Express, pg, vitest + supertest, `expo-server-sdk`. Mobile: Expo (managed) + TypeScript, Expo Router, TanStack Query (+ persist), expo-secure-store, expo-camera, expo-notifications, jest-expo + @testing-library/react-native.

## Global Constraints

- **Free-only:** no paid services. Backend rides the existing Railway deployment; builds use EAS free tier or local builds; v1 ships as an APK on GitHub Releases (Play Store = optional later, $25 one-time, NOT part of this plan).
- **Backend changes are additive only** — the Next.js storefront must keep working untouched. Follow existing conventions exactly: routers in `src/routes/`, parameterized `pool.query`, vitest + supertest with `vi.mock('../src/db')`, `tokenFor()` helper from `tests/helpers.ts`.
- **Backend repo root:** `C:\@JERIC\Important\@Projects\shelfstock\backend` (git repo root is `C:\@JERIC\Important\@Projects\shelfstock`).
- **Mobile repo root:** `C:\@JERIC\Important\@Projects\Mobile\shelfstock-companion`.
- **API shapes (verified against source, do not invent others):**
  - `POST /api/auth/login` → `{ user: { id, email, role }, token }`; 401 `{ error }` on bad credentials.
  - `GET /api/orders?status=&page=&limit=` (admin) → `{ orders: (Order & { user_email })[], pagination: { page, limit, total, totalPages } }`.
  - `GET /api/orders/:id` → `{ ...order, items: (OrderItem & { product_name })[] }`.
  - `PATCH /api/orders/:id/status` body `{ status }` → updated order. `cancelled` is terminal (400 if changing from cancelled).
  - `GET /api/products?search=&page=&limit=` → `{ products: Product[], pagination }`.
  - `POST /api/products` / `PUT /api/products/:id` (admin) → product row. Numeric `price` comes back from pg as a **string**.
- **JWT:** `Authorization: Bearer <token>`, payload `{ userId, role }`, 7-day expiry. Admin gating = `requireAuth` + `adminOnly` (401/403 with `{ error }`).
- All commits use conventional-commit style (`feat:`, `test:`, `chore:`) and end with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Node/npm only (no yarn/pnpm). All mobile dependency installs go through `npx expo install` so versions match the Expo SDK.

---

# Phase A — Backend (shelfstock repo)

### Task 1: Barcode column + lookup endpoint

**Files:**
- Modify: `backend/src/db/schema.sql` (products table)
- Create: `backend/scripts/migrations/001-product-barcode.sql`
- Modify: `backend/src/types/index.ts` (Product interface)
- Modify: `backend/src/routes/products.ts`
- Test: `backend/tests/products.routes.test.ts`

**Interfaces:**
- Consumes: existing `pool`, `requireAuth`, `adminOnly`, test helpers.
- Produces: `GET /api/products/barcode/:code` (admin-only) → 200 product row | 404 `{ error: 'No product with this barcode' }` | 400 `{ error: 'Invalid barcode' }`. `products.barcode: string | null` column, unique.

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/products.routes.test.ts`:

```ts
describe('GET /api/products/barcode/:code', () => {
  it('returns the product for a known barcode', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: 7, name: 'Mug', barcode: '4800001234567' }] });

    const res = await request(app)
      .get('/api/products/barcode/4800001234567')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(7);
    expect(poolQuery.mock.calls[0][0]).toContain('barcode = $1');
    expect(poolQuery.mock.calls[0][1]).toEqual(['4800001234567']);
  });

  it('404s for an unknown barcode', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/products/barcode/0000000000000')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);

    expect(res.status).toBe(404);
  });

  it('rejects non-admin users', async () => {
    const res = await request(app)
      .get('/api/products/barcode/4800001234567')
      .set('Authorization', `Bearer ${tokenFor(2, 'customer')}`);

    expect(res.status).toBe(403);
  });

  it('400s on an overlong code', async () => {
    const res = await request(app)
      .get(`/api/products/barcode/${'9'.repeat(65)}`)
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `npx vitest run tests/products.routes.test.ts`
Expected: the four new tests FAIL (route doesn't exist → the 404 catch-all answers, so statuses/bodies mismatch).

- [ ] **Step 3: Schema + migration.** In `backend/src/db/schema.sql`, inside `CREATE TABLE IF NOT EXISTS products (...)`, add after the `image_url` line:

```sql
  barcode     VARCHAR(64) UNIQUE,
```

Create `backend/scripts/migrations/001-product-barcode.sql`:

```sql
-- Adds barcode support for the ShelfStock Companion mobile app.
-- Apply locally:  docker compose exec -T db psql -U postgres shelfstock < backend/scripts/migrations/001-product-barcode.sql
-- Apply on Railway: psql "$DATABASE_URL" -f backend/scripts/migrations/001-product-barcode.sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(64) UNIQUE;
```

In `backend/src/types/index.ts`, add to the `Product` interface after `image_url`:

```ts
  barcode: string | null;
```

- [ ] **Step 4: Add the route.** In `backend/src/routes/products.ts`, **above** the existing `router.get('/:id', ...)` handler (order matters — `/:id` must not shadow it), add:

```ts
/**
 * GET /api/products/barcode/:code - admin lookup used by the companion
 * app's scanner. Registered before /:id so the literal path wins.
 */
router.get('/barcode/:code', requireAuth, adminOnly, async (req, res) => {
  const code = req.params.code.trim();
  if (!code || code.length > 64) {
    return res.status(400).json({ error: 'Invalid barcode' });
  }
  try {
    const result = await pool.query('SELECT * FROM products WHERE barcode = $1', [code]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'No product with this barcode' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Barcode lookup error:', err);
    res.status(500).json({ error: 'Failed to look up barcode' });
  }
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/products.routes.test.ts`
Expected: PASS (all tests in file, old and new).

- [ ] **Step 6: Apply the migration locally** (if the docker stack is up): `docker compose exec -T db psql -U postgres shelfstock < backend/scripts/migrations/001-product-barcode.sql` — expect `ALTER TABLE`. If the stack isn't running, skip; fresh DBs get it from schema.sql.

- [ ] **Step 7: Commit** (from the shelfstock repo root)

```bash
git add backend/src/db/schema.sql backend/scripts/migrations/001-product-barcode.sql backend/src/types/index.ts backend/src/routes/products.ts backend/tests/products.routes.test.ts
git commit -m "feat: product barcode column and admin lookup endpoint"
```

### Task 2: Accept barcode on product create/update (409 on duplicates)

**Files:**
- Modify: `backend/src/routes/products.ts` (`validateProductFields`, POST `/`, PUT `/:id`)
- Test: `backend/tests/products.routes.test.ts`

**Interfaces:**
- Consumes: Task 1's `barcode` column.
- Produces: `POST /api/products` and `PUT /api/products/:id` accept optional `barcode?: string | null`; duplicate barcode → 409 `{ error: 'A product with this barcode already exists' }`.

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/products.routes.test.ts`:

```ts
describe('product barcode on create/update', () => {
  const admin = () => `Bearer ${tokenFor(1, 'admin')}`;
  const base = { name: 'Mug', price: 9.5, category: 'Kitchen' };

  it('passes barcode through on create', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: 1, ...base, barcode: '123' }] });

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', admin())
      .send({ ...base, barcode: ' 123 ' });

    expect(res.status).toBe(201);
    expect(poolQuery.mock.calls[0][0]).toContain('barcode');
    expect(poolQuery.mock.calls[0][1]).toContain('123'); // trimmed
  });

  it('409s when the barcode is already taken (create)', async () => {
    poolQuery.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'products_barcode_key' })
    );

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', admin())
      .send({ ...base, barcode: '123' });

    expect(res.status).toBe(409);
  });

  it('409s when the barcode is already taken (update)', async () => {
    poolQuery.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'products_barcode_key' })
    );

    const res = await request(app)
      .put('/api/products/5')
      .set('Authorization', admin())
      .send({ barcode: '123' });

    expect(res.status).toBe(409);
  });

  it('rejects a non-string barcode', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', admin())
      .send({ ...base, barcode: 42 });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run tests/products.routes.test.ts`. Expected: the four new tests FAIL.

- [ ] **Step 3: Implement.** In `backend/src/routes/products.ts`:

(a) In `validateProductFields`, add `barcode` to the destructure, and add before `return null;`:

```ts
  if (barcode !== undefined && barcode !== null && (typeof barcode !== 'string' || !barcode.trim() || barcode.trim().length > 64)) {
    return 'barcode must be a non-empty string (max 64 chars)';
  }
```

(b) Add a tiny helper near `parseId`:

```ts
// pg raises 23505 on unique violations; the constraint name tells us which
// column so other unique constraints keep their own error handling.
function isBarcodeConflict(err: any): boolean {
  return err?.code === '23505' && String(err?.constraint ?? '').includes('barcode');
}
```

(c) POST `/`: destructure `barcode` from `req.body`, change the INSERT to:

```ts
    const result = await pool.query(
      `INSERT INTO products (name, description, price, category, stock, image_url, barcode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name.trim(), description ?? null, price, category.trim(), stock ?? 0, image_url || null, barcode ? barcode.trim() : null]
    );
```

and in its `catch`, before the 500:

```ts
    if (isBarcodeConflict(err)) {
      return res.status(409).json({ error: 'A product with this barcode already exists' });
    }
```

(d) PUT `/:id`: destructure `barcode`, change the UPDATE to:

```ts
      `UPDATE products
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           price = COALESCE($3, price),
           category = COALESCE($4, category),
           stock = COALESCE($5, stock),
           image_url = COALESCE($6, image_url),
           barcode = COALESCE($7, barcode)
       WHERE id = $8
       RETURNING *`,
      [name, description, price, category, stock, image_url, barcode === undefined ? null : (barcode ? barcode.trim() : null), id]
```

and add the same 409 branch to its `catch`.
(Note: with COALESCE, sending `barcode: null` cannot clear a barcode — acceptable for v1; it matches how every other field here behaves.)

- [ ] **Step 4: Run the whole backend suite** — `npx vitest run`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/products.ts backend/tests/products.routes.test.ts
git commit -m "feat: accept barcode on product create/update with 409 on duplicates"
```

### Task 3: Device-token registration endpoints

**Files:**
- Modify: `backend/src/db/schema.sql`
- Create: `backend/scripts/migrations/002-device-tokens.sql`
- Create: `backend/src/routes/devices.ts`
- Modify: `backend/src/app.ts`
- Test (create): `backend/tests/devices.routes.test.ts`

**Interfaces:**
- Consumes: `pool`, `requireAuth`, `adminOnly`.
- Produces: `POST /api/devices` body `{ token: string }` → 201 `{ ok: true }` (upsert); `DELETE /api/devices/:token` → 200 `{ ok: true }`. Both admin-only. Table `device_tokens(id, user_id → users, token UNIQUE, created_at)`.

- [ ] **Step 1: Write the failing tests** — create `backend/tests/devices.routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/db', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pool } from '../src/db';
import { createApp } from '../src/app';
import { tokenFor } from './helpers';

const poolQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const app = createApp();

beforeEach(() => {
  vi.clearAllMocks();
  poolQuery.mockResolvedValue({ rows: [] });
});

describe('POST /api/devices', () => {
  it('upserts the token for the authed admin', async () => {
    const res = await request(app)
      .post('/api/devices')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ token: 'ExponentPushToken[abc123]' });

    expect(res.status).toBe(201);
    const [sql, values] = poolQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO device_tokens');
    expect(sql).toContain('ON CONFLICT');
    expect(values).toEqual([1, 'ExponentPushToken[abc123]']);
  });

  it('400s without a token string', async () => {
    const res = await request(app)
      .post('/api/devices')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('403s for non-admins', async () => {
    const res = await request(app)
      .post('/api/devices')
      .set('Authorization', `Bearer ${tokenFor(2, 'customer')}`)
      .send({ token: 'ExponentPushToken[abc123]' });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/devices/:token', () => {
  it('deletes the token', async () => {
    const res = await request(app)
      .delete('/api/devices/ExponentPushToken%5Babc123%5D')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);

    expect(res.status).toBe(200);
    expect(poolQuery.mock.calls[0][1]).toEqual(['ExponentPushToken[abc123]']);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/devices.routes.test.ts`. Expected: FAIL (404s from the catch-all).

- [ ] **Step 3: Schema + migration.** Append to `backend/src/db/schema.sql`:

```sql
-- Expo push tokens for the ShelfStock Companion admin app. One row per
-- device; ON CONFLICT upsert keeps re-registration idempotent.
CREATE TABLE IF NOT EXISTS device_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(200) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Create `backend/scripts/migrations/002-device-tokens.sql` with the same `CREATE TABLE IF NOT EXISTS device_tokens (...)` block (verbatim copy, plus the apply-instructions comment header used in 001).

- [ ] **Step 4: Route.** Create `backend/src/routes/devices.ts`:

```ts
import { Router } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { adminOnly } from '../middleware/adminOnly';

const router = Router();

// POST /api/devices { token } - register this device for admin push.
// Upsert: reinstalls and token rotations just repoint the row.
router.post('/', requireAuth, adminOnly, async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token || token.length > 200) {
    return res.status(400).json({ error: 'token is required (max 200 chars)' });
  }
  try {
    await pool.query(
      `INSERT INTO device_tokens (user_id, token) VALUES ($1, $2)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [req.user!.userId, token]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Register device error:', err);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// DELETE /api/devices/:token - called on logout / notifications-off.
router.delete('/:token', requireAuth, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM device_tokens WHERE token = $1', [req.params.token]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Unregister device error:', err);
    res.status(500).json({ error: 'Failed to unregister device' });
  }
});

export default router;
```

In `backend/src/app.ts`: add `import devicesRoutes from './routes/devices';` with the other route imports, and `app.use('/api/devices', devicesRoutes);` after the `customers` line.

- [ ] **Step 5: Run tests** — `npx vitest run`. Expected: PASS (whole suite).

- [ ] **Step 6: Apply migration locally** (same command shape as Task 1 Step 6, file `002-device-tokens.sql`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/schema.sql backend/scripts/migrations/002-device-tokens.sql backend/src/routes/devices.ts backend/src/app.ts backend/tests/devices.routes.test.ts
git commit -m "feat: device token registration endpoints for companion push"
```

### Task 4: Expo push notification on new orders

**Files:**
- Create: `backend/src/push.ts`
- Modify: `backend/src/routes/orders.ts` (POST `/` fire-and-forget block)
- Test (create): `backend/tests/push.test.ts`
- Test (modify): `backend/tests/orders.routes.test.ts`
- Modify: `backend/package.json` (dependency)

**Interfaces:**
- Consumes: `device_tokens` table (Task 3).
- Produces: `notifyAdminsNewOrder(order: { id: number; total_amount: string }): Promise<void>` — sends `data: { orderId }` so the app can deep-link. Never throws into the request path.

- [ ] **Step 1: Install the SDK** (from `backend/`): `npm install expo-server-sdk`

- [ ] **Step 2: Write the failing unit test** — create `backend/tests/push.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn().mockResolvedValue([]);
vi.mock('expo-server-sdk', () => {
  class Expo {
    static isExpoPushToken = (t: string) => t.startsWith('ExponentPushToken');
    chunkPushNotifications = (msgs: unknown[]) => [msgs];
    sendPushNotificationsAsync = sendMock;
  }
  return { Expo };
});
vi.mock('../src/db', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../src/db';
import { notifyAdminsNewOrder } from '../src/push';

const poolQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe('notifyAdminsNewOrder', () => {
  it('sends one message per valid token with the order id as data', async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [{ token: 'ExponentPushToken[a]' }, { token: 'garbage' }],
    });

    await notifyAdminsNewOrder({ id: 42, total_amount: '19.50' });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const chunk = sendMock.mock.calls[0][0];
    expect(chunk).toHaveLength(1); // invalid token filtered out
    expect(chunk[0]).toMatchObject({
      to: 'ExponentPushToken[a]',
      data: { orderId: 42 },
    });
    expect(chunk[0].body).toContain('42');
  });

  it('swallows send errors', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ token: 'ExponentPushToken[a]' }] });
    sendMock.mockRejectedValueOnce(new Error('expo down'));

    await expect(notifyAdminsNewOrder({ id: 1, total_amount: '1.00' })).resolves.toBeUndefined();
  });

  it('does nothing with zero registered devices', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    await notifyAdminsNewOrder({ id: 1, total_amount: '1.00' });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run tests/push.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement** — create `backend/src/push.ts`:

```ts
import { Expo } from 'expo-server-sdk';
import { pool } from './db';

// One client for the process; Expo's push API needs no credentials for
// basic sends, which keeps this feature on the free tier.
const expo = new Expo();

/**
 * Fire-and-forget push to every registered companion-app device when a
 * new order lands. Mirrors the mail.ts contract: log-and-continue, never
 * throw into the order request path.
 */
export async function notifyAdminsNewOrder(order: { id: number; total_amount: string }): Promise<void> {
  try {
    const { rows } = await pool.query('SELECT token FROM device_tokens');
    const messages = rows
      .filter((r: { token: string }) => Expo.isExpoPushToken(r.token))
      .map((r: { token: string }) => ({
        to: r.token,
        sound: 'default' as const,
        title: 'New order',
        body: `Order #${order.id} — $${order.total_amount}`,
        data: { orderId: order.id },
      }));
    if (messages.length === 0) return;

    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        console.error('Expo push send error:', err);
      }
    }
  } catch (err) {
    console.error('Expo push error:', err);
  }
}
```

- [ ] **Step 5: Run** — `npx vitest run tests/push.test.ts`. Expected: PASS.

- [ ] **Step 6: Hook into order creation.** In `backend/src/routes/orders.ts`, add `import { notifyAdminsNewOrder } from '../push';` at the top, then in POST `/` directly after the existing email fire-and-forget block (the `pool.query('SELECT email...').then(...).catch(...)` statement after `res.status(201).json(order)`), add:

```ts
    // Same fire-and-forget contract as the confirmation email above.
    notifyAdminsNewOrder(order).catch((pushErr) => console.error('Order push error:', pushErr));
```

Then in `backend/tests/orders.routes.test.ts`, add at the top with the other mocks (`vi.mock` calls are hoisted, so placement next to the existing `vi.mock('../src/db', ...)` is fine):

```ts
vi.mock('../src/push', () => ({ notifyAdminsNewOrder: vi.fn().mockResolvedValue(undefined) }));
```

and extend the existing successful-creation test (the one asserting a 201 from `POST /api/orders`) with:

```ts
import { notifyAdminsNewOrder } from '../src/push';
// ...inside the successful creation test, after the 201 assertion:
expect(notifyAdminsNewOrder).toHaveBeenCalledWith(expect.objectContaining({ id: expect.anything() }));
```

- [ ] **Step 7: Full suite + typecheck** — `npx vitest run` and `npx tsc --noEmit` (both from `backend/`). Expected: PASS.

- [ ] **Step 8: Commit + deploy backend**

```bash
git add backend/package.json backend/package-lock.json backend/src/push.ts backend/src/routes/orders.ts backend/tests/push.test.ts backend/tests/orders.routes.test.ts
git commit -m "feat: expo push to companion devices on new orders"
git push
```

Pushing to the default branch deploys via the existing Railway setup. Then run both migration files against the Railway DB: `psql "$DATABASE_URL" -f backend/scripts/migrations/001-product-barcode.sql` and `...002-device-tokens.sql` (get `DATABASE_URL` from the Railway dashboard, or use `railway run`). Verify with `curl https://<railway-api-url>/health` → `{"status":"ok"}`.

---

# Phase B — Mobile app (this repo)

### Task 5: Scaffold the Expo app + tooling

**Files:**
- Create: entire Expo project at repo root (via `create-expo-app`), then trim
- Modify: `app.json`, `package.json`
- Create: `jest.config.js` (or `jest` key in package.json), `.env.example`

**Interfaces:**
- Produces: bootable Expo app with Expo Router, `npm run typecheck` / `npm run lint` / `npm test` scripts, deps installed for every later task: `@tanstack/react-query`, `@tanstack/react-query-persist-client`, `@tanstack/query-async-storage-persister`, `@react-native-async-storage/async-storage`, `@react-native-community/netinfo`, `expo-secure-store`, `expo-camera`, `expo-notifications`, `expo-device`, `expo-constants`.

- [ ] **Step 1: Scaffold.** The repo root already contains `.git/` and `docs/`, and `create-expo-app` wants an empty directory, so scaffold to a temp dir and move (Git Bash):

```bash
cd "/c/@JERIC/Important/@Projects/Mobile/shelfstock-companion"
npx create-expo-app@latest tmp-scaffold --template default --no-install
rm -rf tmp-scaffold/.git
shopt -s dotglob && mv tmp-scaffold/* . && rmdir tmp-scaffold
npm install
```

- [ ] **Step 2: Trim the template.** Run `npm run reset-project` if the template provides it (moves example screens to `app-example/`; delete that folder), otherwise manually delete example screens/components so `app/` contains only `_layout.tsx` and a placeholder `index.tsx`. Keep the template's `components/`-level primitives only if something still imports them.

- [ ] **Step 3: Install feature deps** (versions resolved by Expo):

```bash
npx expo install expo-secure-store expo-camera expo-notifications expo-device expo-constants @react-native-async-storage/async-storage @react-native-community/netinfo
npm install @tanstack/react-query @tanstack/react-query-persist-client @tanstack/query-async-storage-persister
npx expo install jest-expo jest -- --save-dev
npm install --save-dev @testing-library/react-native @types/jest typescript
```

- [ ] **Step 4: Configure.** In `app.json` set:

```json
{
  "expo": {
    "name": "ShelfStock Companion",
    "slug": "shelfstock-companion",
    "scheme": "shelfstock-companion",
    "android": { "package": "com.jeric.shelfstockcompanion" }
  }
}
```

(merge into the generated file — keep the template's other keys like `icon`, `splash`, `plugins`). In `package.json` add:

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "lint": "expo lint",
  "test": "jest"
},
"jest": { "preset": "jest-expo" }
```

Create `.env.example`:

```bash
# Base URL of the ShelfStock API (no trailing slash).
# Android emulator -> host machine: http://10.0.2.2:4000
# Physical device on same wifi:     http://<your-lan-ip>:4000
# Production:                       your Railway API URL
EXPO_PUBLIC_API_URL=http://10.0.2.2:4000
```

Copy it to `.env` (gitignored by the template; if not, add `.env` to `.gitignore`).

- [ ] **Step 5: Verify** — `npm run typecheck` passes; `npx expo start` boots and renders the placeholder screen (press `a` for the Android emulator, or scan the QR with Expo Go).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Expo app with router, query, and test tooling"
```

### Task 6: API client, shared types, auth context

**Files:**
- Create: `src/api/config.ts`, `src/api/client.ts`, `src/api/types.ts`, `src/auth/AuthContext.tsx`
- Test (create): `src/api/__tests__/client.test.ts`

**Interfaces:**
- Produces (later tasks import these exact names):
  - `api<T>(path: string, options?: RequestInit): Promise<T>` — attaches JWT, throws `ApiError { status: number; message }` on non-2xx, JSON-parses the body.
  - `setOnUnauthorized(cb: () => void)` — fired on any 401.
  - `API_URL: string`.
  - Types: `PublicUser`, `Product`, `OrderStatus`, `Order`, `OrderListItem`, `OrderDetail`, `OrderItem`, `Paginated<T>`.
  - `useAuth(): { user: PublicUser | null; initializing: boolean; login(email, password): Promise<void>; logout(): Promise<void> }` and `AuthProvider`.
  - `logoutHandlers: Array<() => Promise<void>>` — modules (push, task 13) can append cleanup that runs before the token is cleared.

- [ ] **Step 1: Types.** Create `src/api/types.ts` (mirrors the backend's verified shapes):

```ts
export type UserRole = 'customer' | 'admin';

export interface PublicUser {
  id: number;
  email: string;
  role: UserRole;
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  price: string; // pg NUMERIC serializes as string
  category: string;
  stock: number;
  image_url: string | null;
  barcode: string | null;
  created_at: string;
}

export type OrderStatus = 'pending' | 'shipped' | 'completed' | 'cancelled';

export interface Order {
  id: number;
  user_id: number;
  total_amount: string;
  currency: string;
  status: OrderStatus;
  payment_method: string;
  shipping_name: string | null;
  shipping_phone: string | null;
  shipping_address: string | null;
  shipping_city: string | null;
  created_at: string;
}

export interface OrderListItem extends Order {
  user_email: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  price_at_purchase: string;
  product_name: string;
}

export interface OrderDetail extends Order {
  items: OrderItem[];
}

export interface Paginated<T> {
  pagination: { page: number; limit: number; total: number; totalPages: number };
  // list key differs per endpoint; endpoints declare their own full shape
  [key: string]: unknown;
}

export interface OrdersListResponse {
  orders: OrderListItem[];
  pagination: Paginated<never>['pagination'];
}

export interface ProductsListResponse {
  products: Product[];
  pagination: Paginated<never>['pagination'];
}
```

- [ ] **Step 2: Config + client.** Create `src/api/config.ts`:

```ts
// EXPO_PUBLIC_* vars are inlined at build time by Expo. Set in .env for
// dev; for release builds set it in eas.json (Task 16).
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000';
```

Create `src/api/client.ts`:

```ts
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

export const TOKEN_KEY = 'shelfstock_jwt';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: (() => void) | null) {
  onUnauthorized = cb;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401) onUnauthorized?.();

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}
```

- [ ] **Step 3: Write client tests** — create `src/api/__tests__/client.test.ts`:

```ts
const store: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    store[k] = v;
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((k: string) => {
    delete store[k];
    return Promise.resolve();
  }),
}));

import { api, ApiError, setOnUnauthorized, TOKEN_KEY } from '../client';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(store)) delete store[k];
  setOnUnauthorized(null);
});

it('sends the stored JWT as a Bearer header', async () => {
  store[TOKEN_KEY] = 'tok123';
  respond(200, { ok: true });

  await api('/api/orders');

  const [, init] = fetchMock.mock.calls[0];
  expect(init.headers.Authorization).toBe('Bearer tok123');
});

it('throws ApiError carrying the server error message', async () => {
  respond(400, { error: 'Invalid status filter' });

  await expect(api('/api/orders?status=nope')).rejects.toMatchObject({
    status: 400,
    message: 'Invalid status filter',
  });
});

it('fires onUnauthorized on a 401', async () => {
  const cb = jest.fn();
  setOnUnauthorized(cb);
  respond(401, { error: 'Invalid or expired token' });

  await expect(api('/api/orders')).rejects.toBeInstanceOf(ApiError);
  expect(cb).toHaveBeenCalled();
});
```

- [ ] **Step 4: Run tests** — `npm test`. Expected: PASS (3 tests).

- [ ] **Step 5: Auth context.** Create `src/auth/AuthContext.tsx`:

```tsx
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, ApiError, setOnUnauthorized, TOKEN_KEY } from '../api/client';
import type { PublicUser } from '../api/types';

const USER_KEY = 'shelfstock_user';

// Cleanup hooks (e.g. push-token unregistration) that must run while the
// JWT is still valid, before logout clears it.
export const logoutHandlers: Array<() => Promise<void>> = [];

interface AuthState {
  user: PublicUser | null;
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // Restore a previous session; the 7-day JWT makes this usually valid.
    (async () => {
      try {
        const [token, rawUser] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (token && rawUser) setUser(JSON.parse(rawUser));
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  const logout = useCallback(async () => {
    for (const handler of logoutHandlers) {
      await handler().catch(() => {}); // cleanup is best-effort
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    // Expired/invalid token on any request boots us back to login.
    setOnUnauthorized(() => {
      void logout();
    });
    return () => setOnUnauthorized(null);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ user: PublicUser; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (res.user.role !== 'admin') {
      throw new ApiError(403, 'This app is for store admins.');
    }
    await SecureStore.setItemAsync(TOKEN_KEY, res.token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
  }, []);

  return (
    <AuthContext.Provider value={{ user, initializing, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

- [ ] **Step 6: Typecheck + tests** — `npm run typecheck && npm test`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat: API client, shared types, and auth context"
```

### Task 7: Login screen, guarded tabs, settings-with-logout

**Files:**
- Create/Replace: `app/_layout.tsx`, `app/login.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx` (placeholder), `app/(tabs)/inventory.tsx` (placeholder), `app/(tabs)/settings.tsx`
- Delete: the scaffold's placeholder `app/index.tsx` (the `(tabs)` group now owns `/`)
- Test (create): `src/auth/__tests__/login.test.tsx`

**Interfaces:**
- Consumes: `AuthProvider`, `useAuth` (Task 6).
- Produces: route structure every later task navigates within: `/login`, `/(tabs)` (index = Orders, inventory, settings), and a root `<Stack>` that later tasks add screens to (`orders/[id]`, `products/[id]`, `products/new`, `scan`).

- [ ] **Step 1: Root layout.** Replace `app/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../src/auth/AuthContext';

// Module scope: survives fast-refresh, one cache for the app.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ title: 'Sign in', headerShown: false }} />
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

(Task 14 swaps `QueryClientProvider` for `PersistQueryClientProvider`; Task 13 adds the notification listener.)

- [ ] **Step 2: Login screen.** Create `app/login.tsx`:

```tsx
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/auth/AuthContext';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ShelfStock Companion</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={onSubmit}
        disabled={busy || !email || !password}
        accessibilityLabel="Sign in"
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  error: { color: '#c0392b' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
```

- [ ] **Step 3: Guarded tabs.** Create `app/(tabs)/_layout.tsx`:

```tsx
import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/auth/AuthContext';

export default function TabsLayout() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
```

Create placeholder `app/(tabs)/index.tsx` and `app/(tabs)/inventory.tsx` (replaced in Tasks 8/10):

```tsx
import { Text, View } from 'react-native';

export default function Placeholder() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Coming soon</Text>
    </View>
  );
}
```

Create `app/(tabs)/settings.tsx`:

```tsx
import { Button, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';

export default function SettingsScreen() {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Signed in as</Text>
      <Text style={styles.email}>{user?.email}</Text>
      <Button
        title="Log out"
        onPress={async () => {
          await logout();
          router.replace('/login');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  label: { color: '#666' },
  email: { fontSize: 16, fontWeight: '600', marginBottom: 24 },
});
```

Delete the scaffold's `app/index.tsx` if it still exists (the tabs group's `index` now serves `/`).

- [ ] **Step 4: Write the login test** — create `src/auth/__tests__/login.test.tsx`:

```tsx
const store: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    store[k] = v;
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AuthProvider } from '../AuthContext';
import LoginScreen from '../../../app/login';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

it('shows the server error on failed login', async () => {
  respond(401, { error: 'Invalid email or password' });

  render(
    <AuthProvider>
      <LoginScreen />
    </AuthProvider>
  );
  fireEvent.changeText(screen.getByPlaceholderText('Email'), 'a@b.com');
  fireEvent.changeText(screen.getByPlaceholderText('Password'), 'wrongpass');
  fireEvent.press(screen.getByLabelText('Sign in'));

  await waitFor(() => expect(screen.getByText('Invalid email or password')).toBeTruthy());
});

it('blocks non-admin accounts with a clear message', async () => {
  respond(200, { user: { id: 2, email: 'a@b.com', role: 'customer' }, token: 't' });

  render(
    <AuthProvider>
      <LoginScreen />
    </AuthProvider>
  );
  fireEvent.changeText(screen.getByPlaceholderText('Email'), 'a@b.com');
  fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password1');
  fireEvent.press(screen.getByLabelText('Sign in'));

  await waitFor(() => expect(screen.getByText('This app is for store admins.')).toBeTruthy());
});
```

- [ ] **Step 5: Run** — `npm test` and `npm run typecheck`. Expected: PASS.

- [ ] **Step 6: Manual smoke test** — `npx expo start`, log in with the seeded admin account against your local API (`docker compose up -d` in the shelfstock repo; `.env` pointing at `http://10.0.2.2:4000` for the emulator). Verify: bad password shows the error; the customer demo account is refused; the admin lands on tabs; kill and reopen the app → still signed in; Settings → Log out returns to login.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: login flow with admin gate and guarded tab shell"
```

### Task 8: Orders tab (list + status filter)

**Files:**
- Create: `src/api/orders.ts`
- Replace: `app/(tabs)/index.tsx`
- Test (create): `src/api/__tests__/orders.test.ts`

**Interfaces:**
- Consumes: `api`, types, `queryClient` conventions.
- Produces: `useOrders(status?: OrderStatus)` (query key `['orders', status ?? 'all']`), `useOrder(id: number)` (key `['order', id]`), `useUpdateOrderStatus()` mutation `{ id: number; status: OrderStatus }`, and pure `statusActions(status: OrderStatus): OrderStatus[]`.

- [ ] **Step 1: Write failing tests** — create `src/api/__tests__/orders.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure** — `npm test`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement hooks.** Create `src/api/orders.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Order, OrderDetail, OrderStatus, OrdersListResponse } from './types';

// Client-side mirror of the backend lifecycle (cancelled is terminal
// server-side; completed is left terminal here to keep the UI honest).
export function statusActions(status: OrderStatus): OrderStatus[] {
  switch (status) {
    case 'pending':
      return ['shipped', 'cancelled'];
    case 'shipped':
      return ['completed', 'cancelled'];
    default:
      return [];
  }
}

export function useOrders(status?: OrderStatus) {
  return useQuery({
    queryKey: ['orders', status ?? 'all'],
    queryFn: () =>
      api<OrdersListResponse>(`/api/orders?limit=50${status ? `&status=${status}` : ''}`),
  });
}

export function useOrder(id: number) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api<OrderDetail>(`/api/orders/${id}`),
    enabled: Number.isFinite(id),
  });
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: OrderStatus }) =>
      api<Order>(`/api/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', id] });
    },
  });
}
```

- [ ] **Step 4: Orders screen.** Replace `app/(tabs)/index.tsx`:

```tsx
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useOrders } from '../../src/api/orders';
import type { OrderListItem, OrderStatus } from '../../src/api/types';

const FILTERS: (OrderStatus | 'all')[] = ['all', 'pending', 'shipped', 'completed', 'cancelled'];

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: '#e67e22',
  shipped: '#2980b9',
  completed: '#27ae60',
  cancelled: '#7f8c8d',
};

export default function OrdersScreen() {
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const { data, isLoading, isError, error, refetch, isRefetching } = useOrders(
    filter === 'all' ? undefined : filter
  );

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      {isError && <Text style={styles.error}>{(error as Error).message}</Text>}
      <FlatList
        data={data?.orders ?? []}
        keyExtractor={(o) => String(o.id)}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          isLoading ? null : <Text style={styles.empty}>No orders{filter !== 'all' ? ` (${filter})` : ''}</Text>
        }
        renderItem={({ item }) => <OrderRow order={item} />}
      />
    </View>
  );
}

function OrderRow({ order }: { order: OrderListItem }) {
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/orders/${order.id}`)}>
      <View style={styles.rowTop}>
        <Text style={styles.orderId}>#{order.id}</Text>
        <Text style={[styles.status, { color: STATUS_COLORS[order.status] }]}>{order.status}</Text>
      </View>
      <Text style={styles.email}>{order.user_email}</Text>
      <View style={styles.rowTop}>
        <Text>${order.total_amount}</Text>
        <Text style={styles.date}>{new Date(order.created_at).toLocaleDateString()}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: '#111', borderColor: '#111' },
  chipText: { color: '#333' },
  chipTextActive: { color: '#fff' },
  row: { padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd', gap: 4 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between' },
  orderId: { fontWeight: '700' },
  status: { fontWeight: '600', textTransform: 'capitalize' },
  email: { color: '#666' },
  date: { color: '#666' },
  empty: { textAlign: 'center', marginTop: 40, color: '#666' },
  error: { color: '#c0392b', paddingHorizontal: 14 },
});
```

- [ ] **Step 5: Run tests + typecheck** — `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 6: Manual smoke test** — with the local stack seeded (place an order through the web storefront if none exist): list renders, filter chips work, pull-to-refresh works, tapping a row navigates (404 screen for now — the route arrives in Task 9).

- [ ] **Step 7: Commit**

```bash
git add src/api/orders.ts src/api/__tests__/orders.test.ts "app/(tabs)/index.tsx"
git commit -m "feat: orders tab with status filters"
```

### Task 9: Order detail + status actions

**Files:**
- Create: `app/orders/[id].tsx`
- Modify: `app/_layout.tsx` (register the screen)

**Interfaces:**
- Consumes: `useOrder`, `useUpdateOrderStatus`, `statusActions` (Task 8).
- Produces: route `/orders/[id]` — Task 13's notification tap deep-links here.

- [ ] **Step 1: Screen.** Create `app/orders/[id].tsx`:

```tsx
import { ActivityIndicator, Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { statusActions, useOrder, useUpdateOrderStatus } from '../../src/api/orders';
import type { OrderStatus } from '../../src/api/types';

const ACTION_LABELS: Record<OrderStatus, string> = {
  pending: 'Mark pending',
  shipped: 'Mark shipped',
  completed: 'Mark completed',
  cancelled: 'Cancel order',
};

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);
  const { data: order, isLoading, isError, error } = useOrder(orderId);
  const mutation = useUpdateOrderStatus();

  function onAction(status: OrderStatus) {
    const run = () =>
      mutation.mutate(
        { id: orderId, status },
        { onError: (err) => Alert.alert('Update failed', (err as Error).message) }
      );
    if (status === 'cancelled') {
      // Cancelling restores stock and is terminal on the backend.
      Alert.alert('Cancel this order?', 'Stock will be restored. This cannot be undone.', [
        { text: 'Keep order', style: 'cancel' },
        { text: 'Cancel order', style: 'destructive', onPress: run },
      ]);
    } else {
      run();
    }
  }

  if (isLoading) return <ActivityIndicator style={styles.center} />;
  if (isError || !order)
    return <Text style={[styles.center, styles.error]}>{(error as Error)?.message ?? 'Not found'}</Text>;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: `Order #${order.id}` }} />
      <Text style={styles.status}>Status: {order.status}</Text>

      <Text style={styles.section}>Items</Text>
      {order.items.map((item) => (
        <View key={item.id} style={styles.itemRow}>
          <Text style={styles.itemName}>
            {item.quantity} × {item.product_name}
          </Text>
          <Text>${item.price_at_purchase}</Text>
        </View>
      ))}
      <View style={styles.itemRow}>
        <Text style={styles.total}>Total</Text>
        <Text style={styles.total}>${order.total_amount}</Text>
      </View>

      <Text style={styles.section}>Shipping</Text>
      <Text>{order.shipping_name}</Text>
      <Text>{order.shipping_phone}</Text>
      <Text>
        {order.shipping_address}, {order.shipping_city}
      </Text>

      <View style={styles.actions}>
        {statusActions(order.status).map((next) => (
          <Button
            key={next}
            title={ACTION_LABELS[next]}
            color={next === 'cancelled' ? '#c0392b' : undefined}
            disabled={mutation.isPending}
            onPress={() => onAction(next)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 6 },
  center: { flex: 1, marginTop: 60, textAlign: 'center' },
  error: { color: '#c0392b' },
  status: { fontSize: 16, fontWeight: '600', textTransform: 'capitalize' },
  section: { marginTop: 16, fontSize: 14, fontWeight: '700', color: '#666', textTransform: 'uppercase' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  itemName: { flexShrink: 1, paddingRight: 8 },
  total: { fontWeight: '700' },
  actions: { marginTop: 24, gap: 10 },
});
```

- [ ] **Step 2: Register.** In `app/_layout.tsx`, inside the `<Stack>`, add:

```tsx
          <Stack.Screen name="orders/[id]" options={{ title: 'Order' }} />
```

- [ ] **Step 3: Typecheck + tests** — `npm run typecheck && npm test`. Expected: PASS.

- [ ] **Step 4: Manual smoke test** — from the Orders tab open a pending order: items/shipping/total render; "Mark shipped" flips the status and the list reflects it after going back; cancelling asks for confirmation and (verify in the web admin or psql) restores stock; a completed order shows no action buttons.

- [ ] **Step 5: Commit**

```bash
git add "app/orders/[id].tsx" app/_layout.tsx
git commit -m "feat: order detail with lifecycle status actions"
```

### Task 10: Inventory tab (list + search)

**Files:**
- Create: `src/api/products.ts`
- Replace: `app/(tabs)/inventory.tsx`
- Test (create): `src/api/__tests__/products.test.ts`

**Interfaces:**
- Consumes: `api`, types.
- Produces: `useProducts(search: string)` (key `['products', search]`), `useProduct(id)` (key `['product', id]`), `useCreateProduct()`, `useUpdateProduct()` (both invalidate `['products']`; update also invalidates `['product', id]`), `ProductInput` type, and `lookupBarcode(code): Promise<Product>` (used by Task 12).

- [ ] **Step 1: Write failing test** — create `src/api/__tests__/products.test.ts`:

```ts
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import { lookupBarcode } from '../products';

const fetchMock = jest.fn();
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
```

- [ ] **Step 2: Run to verify failure** — `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement.** Create `src/api/products.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Product, ProductsListResponse } from './types';

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

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<ProductInput> & { id: number }) =>
      api<Product>(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product', id] });
    },
  });
}
```

- [ ] **Step 4: Screen.** Replace `app/(tabs)/inventory.tsx`:

```tsx
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useProducts } from '../../src/api/products';
import type { Product } from '../../src/api/types';

export default function InventoryScreen() {
  const [search, setSearch] = useState('');
  const { data, isLoading, refetch, isRefetching } = useProducts(search);

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          placeholder="Search products"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        <Pressable style={styles.scanButton} onPress={() => router.push('/scan')} accessibilityLabel="Scan barcode">
          <Ionicons name="barcode-outline" size={22} color="#fff" />
          <Text style={styles.scanText}>Scan</Text>
        </Pressable>
      </View>
      <FlatList
        data={data?.products ?? []}
        keyExtractor={(p) => String(p.id)}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={isLoading ? null : <Text style={styles.empty}>No products</Text>}
        renderItem={({ item }) => <ProductRow product={item} />}
      />
      <Pressable style={styles.fab} onPress={() => router.push('/products/new')} accessibilityLabel="Add product">
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

function ProductRow({ product }: { product: Product }) {
  const low = product.stock <= 5;
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/products/${product.id}`)}>
      <View style={styles.rowText}>
        <Text style={styles.name}>{product.name}</Text>
        <Text style={styles.category}>{product.category}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text>${product.price}</Text>
        <Text style={[styles.stock, low && styles.lowStock]}>{product.stock} in stock</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: { flexDirection: 'row', gap: 8, padding: 12 },
  search: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  scanButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 12 },
  scanText: { color: '#fff', fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  rowText: { flexShrink: 1, paddingRight: 8 },
  name: { fontWeight: '600' },
  category: { color: '#666', fontSize: 12 },
  rowRight: { alignItems: 'flex-end' },
  stock: { color: '#666', fontSize: 12 },
  lowStock: { color: '#c0392b', fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 40, color: '#666' },
  fab: { position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center', elevation: 4 },
});
```

- [ ] **Step 5: Run tests + typecheck** — `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 6: Manual smoke test** — product list renders with demo products; search filters (server-side, may need a beat); Scan and + navigate to not-yet-existing routes (Tasks 11–12).

- [ ] **Step 7: Commit**

```bash
git add src/api/products.ts src/api/__tests__/products.test.ts "app/(tabs)/inventory.tsx"
git commit -m "feat: inventory tab with search and product hooks"
```

### Task 11: Product edit + create screens

**Files:**
- Create: `src/products/ProductForm.tsx`, `app/products/[id].tsx`, `app/products/new.tsx`
- Modify: `app/_layout.tsx` (register both screens)

**Interfaces:**
- Consumes: `useProduct`, `useCreateProduct`, `useUpdateProduct`, `ProductInput` (Task 10).
- Produces: `/products/[id]` (edit) and `/products/new?barcode=...` (create; prefills barcode — Task 12 navigates here). Shared `ProductForm` with props `{ initial?: Partial<ProductInput>; submitLabel: string; busy: boolean; onSubmit(input: ProductInput): void }`.

- [ ] **Step 1: Shared form.** Create `src/products/ProductForm.tsx`:

```tsx
import { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import type { ProductInput } from '../api/products';

interface Props {
  initial?: Partial<ProductInput>;
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: ProductInput) => void;
}

export default function ProductForm({ initial, submitLabel, busy, onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [price, setPrice] = useState(initial?.price != null ? String(initial.price) : '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [stock, setStock] = useState(initial?.stock != null ? String(initial.stock) : '0');
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? '');
  const [barcode, setBarcode] = useState(initial?.barcode ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const priceNum = Number(price);
    const stockNum = Number(stock);
    if (!name.trim()) return setError('Name is required');
    if (!Number.isFinite(priceNum) || priceNum < 0) return setError('Price must be a non-negative number');
    if (!category.trim()) return setError('Category is required');
    if (!Number.isInteger(stockNum) || stockNum < 0) return setError('Stock must be a whole number');
    setError(null);
    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      price: priceNum,
      category: category.trim(),
      stock: stockNum,
      image_url: imageUrl.trim() || null,
      barcode: barcode.trim() || null,
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} />
      <Text style={styles.label}>Description</Text>
      <TextInput style={[styles.input, styles.multiline]} value={description ?? ''} onChangeText={setDescription} multiline />
      <Text style={styles.label}>Price (USD)</Text>
      <TextInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
      <Text style={styles.label}>Category</Text>
      <TextInput style={styles.input} value={category} onChangeText={setCategory} />
      <Text style={styles.label}>Stock</Text>
      <TextInput style={styles.input} value={stock} onChangeText={setStock} keyboardType="number-pad" />
      <Text style={styles.label}>Image URL</Text>
      <TextInput style={styles.input} value={imageUrl ?? ''} onChangeText={setImageUrl} autoCapitalize="none" />
      <Text style={styles.label}>Barcode</Text>
      <TextInput style={styles.input} value={barcode ?? ''} onChangeText={setBarcode} autoCapitalize="none" />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={submitLabel} onPress={submit} disabled={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 6, paddingBottom: 40 },
  label: { fontWeight: '600', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  error: { color: '#c0392b', marginVertical: 8 },
});
```

- [ ] **Step 2: Edit screen.** Create `app/products/[id].tsx`:

```tsx
import { ActivityIndicator, Alert, Text } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useProduct, useUpdateProduct } from '../../src/api/products';
import ProductForm from '../../src/products/ProductForm';

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = Number(id);
  const { data: product, isLoading, isError, error } = useProduct(productId);
  const mutation = useUpdateProduct();

  if (isLoading) return <ActivityIndicator style={{ marginTop: 60 }} />;
  if (isError || !product)
    return <Text style={{ marginTop: 60, textAlign: 'center' }}>{(error as Error)?.message ?? 'Not found'}</Text>;

  return (
    <>
      <Stack.Screen options={{ title: product.name }} />
      <ProductForm
        initial={{
          name: product.name,
          description: product.description,
          price: Number(product.price),
          category: product.category,
          stock: product.stock,
          image_url: product.image_url,
          barcode: product.barcode,
        }}
        submitLabel="Save changes"
        busy={mutation.isPending}
        onSubmit={(input) =>
          mutation.mutate(
            { id: productId, ...input },
            {
              onSuccess: () => router.back(),
              onError: (err) => Alert.alert('Save failed', (err as Error).message),
            }
          )
        }
      />
    </>
  );
}
```

- [ ] **Step 3: Create screen.** Create `app/products/new.tsx`:

```tsx
import { Alert } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCreateProduct } from '../../src/api/products';
import ProductForm from '../../src/products/ProductForm';

export default function NewProductScreen() {
  const { barcode } = useLocalSearchParams<{ barcode?: string }>();
  const mutation = useCreateProduct();

  return (
    <>
      <Stack.Screen options={{ title: 'New product' }} />
      <ProductForm
        initial={{ barcode: barcode ?? null }}
        submitLabel="Create product"
        busy={mutation.isPending}
        onSubmit={(input) =>
          mutation.mutate(input, {
            onSuccess: (created) => router.replace(`/products/${created.id}`),
            onError: (err) => Alert.alert('Create failed', (err as Error).message),
          })
        }
      />
    </>
  );
}
```

- [ ] **Step 4: Register.** In `app/_layout.tsx` add inside `<Stack>`:

```tsx
          <Stack.Screen name="products/[id]" options={{ title: 'Product' }} />
          <Stack.Screen name="products/new" options={{ title: 'New product' }} />
```

- [ ] **Step 5: Typecheck + tests** — `npm run typecheck && npm test`. Expected: PASS.

- [ ] **Step 6: Manual smoke test** — edit a product's price/stock and save (list refreshes); create a product via the + FAB; enter a duplicate barcode on a second product → the 409 message appears in an alert.

- [ ] **Step 7: Commit**

```bash
git add src/products "app/products" app/_layout.tsx
git commit -m "feat: product create and edit screens with shared form"
```

### Task 12: Barcode scanning flow

**Files:**
- Create: `src/scan/resolveBarcode.ts`, `app/scan.tsx`
- Modify: `app/_layout.tsx` (register), `app.json` (camera permission text)
- Test (create): `src/scan/__tests__/resolveBarcode.test.ts`

**Interfaces:**
- Consumes: `lookupBarcode` (Task 10), routes from Task 11.
- Produces: `resolveBarcode(code: string): Promise<{ kind: 'product'; id: number } | { kind: 'new'; barcode: string }>` — 404 means "create it", other errors rethrow.

- [ ] **Step 1: Write failing test** — create `src/scan/__tests__/resolveBarcode.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure** — `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement resolver.** Create `src/scan/resolveBarcode.ts`:

```ts
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
```

- [ ] **Step 4: Run** — `npm test`. Expected: PASS.

- [ ] **Step 5: Scan screen.** Create `app/scan.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Button, Linking, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack } from 'expo-router';
import { resolveBarcode } from '../src/scan/resolveBarcode';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false); // onBarcodeScanned fires repeatedly; gate to one lookup

  async function onScanned({ data }: { data: string }) {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      const resolution = await resolveBarcode(data);
      if (resolution.kind === 'product') {
        router.replace(`/products/${resolution.id}`);
      } else {
        router.replace({ pathname: '/products/new', params: { barcode: resolution.barcode } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
      busyRef.current = false; // allow rescan after an error
    }
  }

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Stack.Screen options={{ title: 'Scan barcode' }} />
        <Text style={styles.permissionText}>
          Scanning needs camera access so it can read product barcodes.
        </Text>
        {permission.canAskAgain ? (
          <Button title="Allow camera" onPress={requestPermission} />
        ) : (
          <Button title="Open settings" onPress={() => Linking.openSettings()} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Scan barcode' }} />
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
        }}
        onBarcodeScanned={onScanned}
      />
      <View style={styles.overlay}>
        <Text style={styles.hint}>Point the camera at a barcode</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered: { justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16, backgroundColor: '#fff' },
  permissionText: { textAlign: 'center', fontSize: 16 },
  overlay: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', gap: 8 },
  hint: { color: '#fff', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  error: { color: '#ff7675', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
});
```

- [ ] **Step 6: Register + permission copy.** In `app/_layout.tsx` add `<Stack.Screen name="scan" options={{ title: 'Scan barcode' }} />`. In `app.json`, add to `expo.plugins` (merge if `expo-camera` is already listed):

```json
["expo-camera", { "cameraPermission": "ShelfStock Companion uses the camera to scan product barcodes." }]
```

- [ ] **Step 7: Typecheck + tests** — `npm run typecheck && npm test`. Expected: PASS.

- [ ] **Step 8: Manual smoke test** (physical device or emulator with camera passthrough): scan a real grocery barcode → unknown → lands on New Product with barcode prefilled; save it; scan the same barcode again → lands on that product's edit screen; deny camera permission → explainer with settings link shows, inventory still works.

- [ ] **Step 9: Commit**

```bash
git add src/scan app/scan.tsx app/_layout.tsx app.json
git commit -m "feat: barcode scan flow with camera permission handling"
```

### Task 13: Push notifications end-to-end

**Files:**
- Create: `src/notifications.ts`
- Modify: `app/_layout.tsx` (tap handler), `src/auth/AuthContext.tsx` is NOT modified — registration hooks in via `logoutHandlers` and the settings screen
- Modify: `app/(tabs)/settings.tsx` (toggle), `app/(tabs)/_layout.tsx` (register on entering tabs)
- Test (create): `src/__tests__/notifications.test.ts`

**Interfaces:**
- Consumes: `api`, `logoutHandlers` (Task 6), `/orders/[id]` route (Task 9), backend `/api/devices` (Task 3).
- Produces: `enablePush(): Promise<boolean>` (permission → token → register; false if declined/unavailable), `disablePush(): Promise<void>`, `getStoredPushToken(): Promise<string | null>`.

- [ ] **Step 1: Write failing test** — create `src/__tests__/notifications.test.ts`:

```ts
const store: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    store[k] = v;
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((k: string) => {
    delete store[k];
    return Promise.resolve();
  }),
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } },
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[t1]' })),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  AndroidImportance: { DEFAULT: 3 },
}));

import { enablePush, disablePush, getStoredPushToken, PUSH_TOKEN_KEY } from '../notifications';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(store)) delete store[k];
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ ok: true }) });
});

it('registers the token with the API and stores it', async () => {
  await expect(enablePush()).resolves.toBe(true);
  expect(fetchMock.mock.calls[0][0]).toContain('/api/devices');
  expect(store[PUSH_TOKEN_KEY]).toBe('ExponentPushToken[t1]');
});

it('unregisters and clears the stored token', async () => {
  store[PUSH_TOKEN_KEY] = 'ExponentPushToken[t1]';

  await disablePush();

  expect(fetchMock.mock.calls[0][0]).toContain('/api/devices/ExponentPushToken%5Bt1%5D');
  expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  await expect(getStoredPushToken()).resolves.toBeNull();
});
```

- [ ] **Step 2: Run to verify failure** — `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement.** Create `src/notifications.ts`:

```ts
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api/client';

export const PUSH_TOKEN_KEY = 'shelfstock_push_token';

// Show notifications even while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function getStoredPushToken(): Promise<string | null> {
  return SecureStore.getItemAsync(PUSH_TOKEN_KEY);
}

/** Permission → Expo token → register with the API. False = declined/unavailable. */
export async function enablePush(): Promise<boolean> {
  if (!Device.isDevice) return false; // emulators without Play services can't receive push

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Orders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return false;

  const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

  await api('/api/devices', { method: 'POST', body: JSON.stringify({ token }) });
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
  return true;
}

/** Best-effort unregister; always clears local state. */
export async function disablePush(): Promise<void> {
  const token = await getStoredPushToken();
  if (token) {
    await api(`/api/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {});
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  }
}
```

- [ ] **Step 4: Run** — `npm test`. Expected: PASS.

- [ ] **Step 5: Wire up.**

(a) Auto-register after login — in `app/(tabs)/_layout.tsx` add:

```tsx
import { useEffect } from 'react';
import { disablePush, enablePush } from '../../src/notifications';
import { logoutHandlers } from '../../src/auth/AuthContext';
```

and inside `TabsLayout`, after the auth guard values are read (before the early returns is fine for hooks-order):

```tsx
  useEffect(() => {
    if (!user) return;
    void enablePush().catch(() => {}); // declining push must never break the app
    if (!logoutHandlers.includes(disablePush)) logoutHandlers.push(disablePush);
  }, [user]);
```

(b) Tap → order deep link — in `app/_layout.tsx`:

```tsx
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
```

and inside `RootLayout`:

```tsx
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const orderId = response.notification.request.content.data?.orderId;
      if (orderId) router.push(`/orders/${orderId}`);
    });
    return () => sub.remove();
  }, []);
```

(c) Settings toggle — in `app/(tabs)/settings.tsx` add a Switch row:

```tsx
import { useEffect, useState } from 'react';
import { Switch } from 'react-native';
import { disablePush, enablePush, getStoredPushToken } from '../../src/notifications';
// inside the component:
  const [pushOn, setPushOn] = useState(false);
  useEffect(() => {
    void getStoredPushToken().then((t) => setPushOn(!!t));
  }, []);
// in the JSX, above the logout button:
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Text style={{ fontSize: 16 }}>New-order notifications</Text>
        <Switch
          value={pushOn}
          onValueChange={async (next) => {
            setPushOn(next ? await enablePush() : (await disablePush(), false));
          }}
        />
      </View>
```

- [ ] **Step 6: One-time project setup for real device push** (config, all free):
  1. `npx eas init` (free Expo account; writes `extra.eas.projectId` into app.json).
  2. Firebase console → create project (no billing) → Android app with package `com.jeric.shelfstockcompanion` → download `google-services.json` into the repo root → in app.json set `"android": { "googleServicesFile": "./google-services.json", ... }`.
  3. Firebase console → Project settings → Service accounts → generate a service-account key JSON → `npx eas credentials` → Android → Google Service Account → upload (enables FCM v1 sends through Expo's push service).
  4. Push does NOT arrive in Expo Go on Android — build a dev client: `npx expo run:android` (local, free) and use that from now on.

- [ ] **Step 7: Typecheck + tests** — `npm run typecheck && npm test`. Expected: PASS.

- [ ] **Step 8: Manual end-to-end test** — dev-client app on a physical device, `.env` pointed at the deployed Railway API (or LAN IP): log in (accept the notification permission), place an order through the storefront (web), phone shows "New order #N — $X" within seconds; tapping it opens that order; Settings toggle off → next order does not notify; toggle back on.

- [ ] **Step 9: Commit**

```bash
git add src/notifications.ts src/__tests__/notifications.test.ts app/_layout.tsx "app/(tabs)/_layout.tsx" "app/(tabs)/settings.tsx" app.json
git commit -m "feat: new-order push notifications with deep link and settings toggle"
```

(`google-services.json` contains no secrets — committing it is standard and keeps builds reproducible.)

### Task 14: Offline read caching + banner

**Files:**
- Create: `src/offline.ts`, `src/components/OfflineBanner.tsx`
- Modify: `app/_layout.tsx` (persisted query client + banner)
- Test (create): `src/components/__tests__/OfflineBanner.test.tsx`

**Interfaces:**
- Consumes: `queryClient` from the root layout.
- Produces: query cache persisted to AsyncStorage (orders/products readable offline); `<OfflineBanner />` shown app-wide when disconnected.

- [ ] **Step 1: Write failing test** — create `src/components/__tests__/OfflineBanner.test.tsx`:

```tsx
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: jest.fn(),
}));

import { render, screen } from '@testing-library/react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import OfflineBanner from '../OfflineBanner';

const netInfoMock = useNetInfo as jest.Mock;

it('renders nothing while online', () => {
  netInfoMock.mockReturnValue({ isConnected: true });
  render(<OfflineBanner />);
  expect(screen.queryByText(/offline/i)).toBeNull();
});

it('shows the banner while offline', () => {
  netInfoMock.mockReturnValue({ isConnected: false });
  render(<OfflineBanner />);
  expect(screen.getByText(/offline — showing cached data/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify failure** — `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement.** Create `src/components/OfflineBanner.tsx`:

```tsx
import { StyleSheet, Text } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';

export default function OfflineBanner() {
  const { isConnected } = useNetInfo();
  if (isConnected !== false) return null; // null = unknown; don't flash the banner on launch
  return <Text style={styles.banner}>Offline — showing cached data</Text>;
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#e67e22',
    color: '#fff',
    textAlign: 'center',
    paddingVertical: 6,
    fontWeight: '600',
  },
});
```

Create `src/offline.ts`:

```ts
import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

// Let TanStack Query pause/resume fetches based on real connectivity
// instead of the browser heuristics it defaults to.
export function wireOnlineManager() {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(!!state.isConnected))
  );
}
```

- [ ] **Step 4: Wire into the root layout.** In `app/_layout.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import OfflineBanner from '../src/components/OfflineBanner';
import { wireOnlineManager } from '../src/offline';

wireOnlineManager();

const persister = createAsyncStoragePersister({ storage: AsyncStorage });
```

Give queries a non-zero `gcTime` so they're eligible for persistence — in the `QueryClient` options: `queries: { staleTime: 30_000, retry: 1, gcTime: 24 * 60 * 60 * 1000 }`. Then replace `<QueryClientProvider client={queryClient}>` with:

```tsx
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
```

(and the matching closing tag), and render `<OfflineBanner />` directly above `<Stack>`.

- [ ] **Step 5: Typecheck + tests** — `npm run typecheck && npm test`. Expected: PASS.

- [ ] **Step 6: Manual smoke test** — browse orders + inventory online; enable airplane mode; kill and reopen the app: banner shows, previously seen lists still render; attempting a status change fails with the error alert; disable airplane mode: banner disappears, refetch works.

- [ ] **Step 7: Commit**

```bash
git add src/offline.ts src/components app/_layout.tsx
git commit -m "feat: offline read caching with connectivity banner"
```

### Task 15: CI for the mobile repo

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `typecheck` / `lint` / `test` scripts (Task 5).
- Produces: green CI on GitHub for every push/PR — the README badge target for Task 16.

- [ ] **Step 1: Workflow.** Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test -- --ci
```

- [ ] **Step 2: Verify locally** — run the same three commands (`npm run typecheck && npm run lint && npm test`). Expected: all pass. Fix any lint noise from template leftovers now.

- [ ] **Step 3: Commit the workflow (plus any lint fixes)**

```bash
git add -A
git commit -m "chore: CI workflow for typecheck, lint, and tests"
```

- [ ] **Step 4: Create the GitHub repo and push**

```bash
gh repo create shelfstock-companion --public --source . --push
```

- [ ] **Step 5: Verify CI is green** — `gh run watch` (or check the Actions tab). Expected: the `checks` job passes.

### Task 16: Release build, GitHub Release, README

**Files:**
- Create: `eas.json`, `README.md` (replace scaffold README), `docs/screenshots/` (PNG/GIF assets)

**Interfaces:**
- Consumes: everything; the deployed Railway API URL.
- Produces: installable signed APK on a GitHub Release — the CV deliverable.

- [ ] **Step 1: EAS build config.** Create `eas.json`:

```json
{
  "cli": { "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_URL": "https://YOUR-RAILWAY-API-URL" }
    }
  }
}
```

Replace `https://YOUR-RAILWAY-API-URL` with the real API URL from the Railway dashboard (this is deployment configuration, looked up at execution time — not a design placeholder).

- [ ] **Step 2: Build the APK** — `npx eas build -p android --profile preview` (free tier; queue waits are normal). Download the `.apk` from the link EAS prints. Install it on a physical device (`adb install` or copy it over) and repeat the Task 13 Step 8 end-to-end check against production.

- [ ] **Step 3: Tag + GitHub Release**

```bash
git tag v1.0.0
git push --tags
gh release create v1.0.0 ./shelfstock-companion.apk --title "ShelfStock Companion v1.0.0" --notes "Admin companion app for ShelfStock: order management with push notifications, barcode-scan inventory, offline read caching. Install the APK on Android 8+."
```

- [ ] **Step 4: README.** Capture screenshots (login, orders list, order detail, scanner, a real push notification) plus a short GIF of scan → product, into `docs/screenshots/`. Replace `README.md` with: project one-liner, CI badge (`https://github.com/<user>/shelfstock-companion/actions/workflows/ci.yml/badge.svg`), link to the APK release, the screenshot grid, a features list, an architecture paragraph (Expo Router + TanStack Query client for the ShelfStock API; link the ShelfStock repo), a "Backend endpoints added" section (barcode lookup, device registration, order push), local-dev setup (`npm install`, `.env` from `.env.example`, `npx expo start` against the docker-compose backend), and the test/CI commands. Follow the tone of the ShelfStock README.

- [ ] **Step 5: Final verification sweep**
  - `npm run typecheck && npm run lint && npm test` → all pass.
  - `gh run list --limit 1` → CI green on the release commit.
  - Fresh-install APK on a device that has never had the app: login → orders → scan → push all work against production.
  - Shelfstock repo: `npx vitest run` green; storefront checkout still works (order placed via web, stock decremented).

- [ ] **Step 6: Commit**

```bash
git add eas.json README.md docs/screenshots
git commit -m "chore: release config, README with screenshots, v1.0.0"
git push
```
