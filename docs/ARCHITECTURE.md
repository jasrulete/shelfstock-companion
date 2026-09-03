# Architecture — ShelfStock Companion

**Canonical for this app. Not canonical for the API.**

This is an Expo/React Native Android app for the admins of
[ShelfStock](https://github.com/jasrulete/Shelfstock). It is a **client**. The
server repository owns the API contract, the data model, the security posture
and every cross-repo decision:

| For | Read |
|---|---|
| The API contract | [Shelfstock/docs/API.md](https://github.com/jasrulete/Shelfstock/blob/main/docs/API.md) |
| System architecture and invariants | [Shelfstock/docs/ARCHITECTURE.md](https://github.com/jasrulete/Shelfstock/blob/main/docs/ARCHITECTURE.md) |
| Security posture and known weaknesses | [Shelfstock/docs/SECURITY.md](https://github.com/jasrulete/Shelfstock/blob/main/docs/SECURITY.md) |
| Decision records, including this app's | [Shelfstock/docs/adr/](https://github.com/jasrulete/Shelfstock/tree/main/docs/adr) |
| What is next | [Shelfstock/docs/ROADMAP.md](https://github.com/jasrulete/Shelfstock/blob/main/docs/ROADMAP.md) |

**When this app disagrees with the server, this app is wrong.** That is not
theoretical — see [§4](#4-known-drift).

---

## 1. What it is for

An admin walking around a stockroom with a phone. Three jobs:

1. **Know a new order arrived**, immediately, without watching a dashboard.
2. **Move an order through its lifecycle** without going back to a desk.
3. **Find or create a product by scanning its barcode**, instead of typing.

Everything else is in service of those. The web admin area already exists and
is better at anything that involves a keyboard.

## 2. Structure

```
src/
  app/                      expo-router file-based navigation
    _layout.tsx             persist provider + notification response handler
    login.tsx
    (tabs)/
      _layout.tsx           guarded tab shell; registers disablePush on logout
      index.tsx             orders, with status filters
      inventory.tsx         products, with search
      settings.tsx          push toggle, logout
    orders/[id].tsx         order detail + lifecycle actions
    products/[id].tsx       product detail/edit
    products/new.tsx
    scan.tsx                camera + barcode resolution
  api/
    config.ts               API_URL, inlined at build time
    client.ts               fetch wrapper: bearer token, 401 -> logout
    orders.ts products.ts   query/mutation hooks
    types.ts                response shapes
  auth/
    AuthContext.tsx         login/logout, SecureStore, logoutHandlers
    RequireAuth.tsx         guards deep-linked screens
  queryClient.ts            the cache, the persister, and what may touch disk
  offline.ts                wires TanStack's onlineManager to connectivity
  notifications.ts          Expo push registration
  products/ProductForm.tsx  shared create/edit form
  scan/resolveBarcode.ts    scanned code -> existing product or create flow
```

## 3. Invariants

Rules that must not be broken without an ADR in the server repository.

### C-INV-1 — The server is the only authority on what is allowed

Never add a client-side rule the server does not enforce, and never keep a
client-side copy of a server rule when the server could just send it.

The admin gate in `AuthContext` (`res.user.role !== 'admin'` → 403) is **UX,
not security**. It exists so a customer account gets a clear message instead of
an empty app. The real gate is `adminOnly` on the server, and it must stay that
way.

### C-INV-2 — No customer PII is written to disk

AsyncStorage is **not encrypted**. `src/queryClient.ts` refuses to dehydrate any
query whose key starts with `orders` or `order`.

**Every order shape carries PII**, not just the detail one: `Order` has
`shipping_name`, `shipping_phone`, `shipping_address` and `shipping_city`, and
`OrderListItem` adds `user_email`. Excluding only the detail query would leave
names, phone numbers and home addresses for every order on the device.

Consequence, accepted deliberately: **offline reads cover products only.** See
[ADR-0004](https://github.com/jasrulete/Shelfstock/blob/main/docs/adr/0004-offline-reads-not-writes.md).

*If you add a query that returns customer data, add its key to
`holdsCustomerPii()` in the same commit.*

### C-INV-3 — The JWT lives in `expo-secure-store`, never AsyncStorage

`expo-secure-store` is encrypted; AsyncStorage is not. This is the reason
C-INV-2 exists at all — a token in encrypted storage beside plaintext customer
addresses is a token that was carefully protected for nothing.

### C-INV-4 — Logout clears both caches, through `logoutHandlers`

`queryClient.clear()` **and** `persister.removeClient()`. Both, or it is not a
logout.

It is registered by pushing `clearPersistedCache` onto the `logoutHandlers`
array — the same extension point `(tabs)/_layout.tsx` uses for `disablePush` —
rather than imported into `AuthContext`. Importing it there would pull
AsyncStorage into every module that touches auth, **including the ones under
test**, where the native module does not exist.

Per-user isolation comes from this clear, not from a cache buster, because
`AuthProvider` renders *inside* the persist provider and cannot feed a user id
up into it. The buster is the app version, which handles changed shapes across
builds.

### C-INV-5 — `EXPO_PUBLIC_API_URL` is baked in at build time

Expo inlines `EXPO_PUBLIC_*` at build. Changing `.env` does nothing until
`npx expo start` is restarted, and a **released APK's API host cannot be
changed at all**.

There is no `expo-updates` and no `runtimeVersion`, so a breaking API change
strands installed builds. Accepted, with reasons, in
[ADR-0008](https://github.com/jasrulete/Shelfstock/blob/main/docs/adr/0008-apk-distribution-no-play-store.md).

*Practical rule: a server change that breaks this app needs a new APK release
in the same breath.*

### C-INV-6 — A 401 means log out, everywhere

`src/api/client.ts` calls `onUnauthorized` on any 401, which boots the session.
Deep-linked screens are additionally guarded by `RequireAuth` so an
unauthenticated deep link lands on login rather than a raw error.

### C-INV-7 — `barcode` may be absent from a product response

The server strips it for non-admin callers. This app always calls as an admin,
so it normally arrives — but `ProductForm` seeds itself from that response, so
**never send a blank barcode back**: doing so writes the blank over the real
one.

The same applies to gallery images on the web side, which is the bug this rule
generalises from.

## 4. Known drift

**`src/api/orders.ts`'s `statusActions()` is a copy of the server's order
lifecycle, and it has drifted.**

| | |
|---|---|
| Server | `pending → ['shipped', 'completed', 'cancelled']` |
| This app | `pending → ['shipped', 'cancelled']` |
| The test | `src/api/__tests__/orders.test.ts` **asserts the drifted value** |

A green test is holding the bug in place. The consequence is real: a same-day
cash-on-delivery handover — the normal case for this store — cannot be
completed from the phone. It is forced through a bogus `shipped` hop, which
also fires a customer "order shipped" email for a parcel handed over in person.

**Do not fix this by correcting the copy.** That is the same class of change
that produced the drift. The fix is
[ADR-0007](https://github.com/jasrulete/Shelfstock/blob/main/docs/adr/0007-server-owns-the-order-lifecycle.md):
the server serves `allowed_transitions`, this app renders from it, and
`statusActions` and its test are deleted.

## 5. Testing

19 tests across 9 Jest suites: `npm test`, `npm run typecheck`, `npm run lint`.
CI runs all three.

`jest.testTimeout` is deliberately raised — CI is always a cold cache, and the
default reads as a broken environment rather than a slow one.

What is worth testing here: **the rules above**. `resolveBarcode`'s branching,
the auth guard, the offline banner, the settings push toggle, and the API
client's 401 handling are all covered because each of them fails silently.
