# ShelfStock Companion

[![CI](https://github.com/jasrulete/shelfstock-companion/actions/workflows/ci.yml/badge.svg)](https://github.com/jasrulete/shelfstock-companion/actions/workflows/ci.yml)

An Android companion app for [ShelfStock](https://github.com/jasrulete/Shelfstock)
admins: manage orders and inventory, get pushed the moment a new order comes
in, and scan a barcode to pull up (or create) a product — all from a phone.

## Screenshots

<!-- Add screenshots here: login, orders list, order detail, scanner, and a
     real push notification, plus a short GIF of scan -> product. -->

Screenshots and the scan demo GIF live in [`docs/screenshots/`](docs/screenshots/).

## Features

- **Order management with a status lifecycle** — view all orders, drill into
  an order's items and shipping details, and move it through
  `pending -> shipped -> completed` (or `cancelled`) right from the phone.
- **New-order push notifications with deep links** — a push fires the moment
  a customer checks out on the storefront; tapping it opens that order's
  detail screen directly.
- **Barcode-scan inventory** — scan a product's barcode with the camera to
  jump straight to its detail/edit screen, or into the create-product form
  pre-filled with the scanned code if no match exists.
- **Offline read caching** — products fetched while online stay available
  read-only when connectivity drops, with a banner indicating stale/offline
  data. Orders are cached in memory for the session but deliberately never
  written to disk: AsyncStorage is not encrypted, and every order shape carries
  the customer's name, phone number and address. Losing the offline order list
  is the better half of that trade.
- **Admin-gated login** — logs in against the same ShelfStock accounts as the
  web admin; non-admin credentials are rejected client-side after auth.

## Architecture

Built with [Expo Router](https://docs.expo.dev/router/introduction/) for
file-based navigation and [TanStack Query](https://tanstack.com/query/latest)
as the data layer, backed by `@tanstack/query-async-storage-persister` for
the offline cache. The app is a thin client over the
[ShelfStock](https://github.com/jasrulete/Shelfstock) REST API — same
backend, same admin accounts, same order/product data as the web storefront's
admin area. Auth uses the existing JWT login endpoint; the token and session
are stored in `expo-secure-store`.

📐 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** is the source of truth for
this app: its structure, the seven invariants that must not be broken, and the
one place it has drifted from the server.

**The server repository owns the API contract.** When this app disagrees with
[Shelfstock/docs/API.md](https://github.com/jasrulete/Shelfstock/blob/main/docs/API.md),
this app is wrong. Cross-repo decisions live in
[Shelfstock/docs/adr/](https://github.com/jasrulete/Shelfstock/tree/main/docs/adr).

## Backend endpoints added

This app required three additions to the ShelfStock backend (implemented in
the [ShelfStock](https://github.com/jasrulete/Shelfstock) repo, not here):

| Method | Path                           | Purpose                                                    |
| ------ | ------------------------------ | ----------------------------------------------------------- |
| GET    | `/api/products/barcode/:code`  | Look up a product by barcode (admin), for the scan flow.    |
| POST   | `/api/devices`                 | Register an Expo push token for the logged-in admin.        |
| DELETE | `/api/devices/:token`          | Unregister a push token (logout / notifications-off).       |

New orders (`POST /api/orders`) additionally trigger a best-effort push to
all registered admin devices.

## Local development

### Prerequisites

- Node.js 20+
- The [ShelfStock](https://github.com/jasrulete/Shelfstock) backend running
  (Docker Compose is the fastest way — see that repo's README)
- [Expo Go](https://expo.dev/go) on a device/emulator, or a dev client build

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

`EXPO_PUBLIC_API_URL` is the base URL of the ShelfStock API (no trailing
slash) — which value to use depends on where you're running the app:

| Target                            | `EXPO_PUBLIC_API_URL`         |
| ---------------------------------- | ------------------------------ |
| Android emulator -> host machine   | `http://10.0.2.2:3000`         |
| Physical device on the same wifi   | `http://<your-lan-ip>:3000`    |
| Production                         | `https://shelfstock-jer2x.vercel.app` |

### 3. Start the backend

From the [ShelfStock](https://github.com/jasrulete/Shelfstock) repo:

```bash
docker compose up -d --build
```

### 4. Start the app

```bash
npx expo start
```

Scan the QR code with Expo Go, or press `a`/`i` to launch an emulator.

## Testing & CI

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm test            # jest
```

CI (see the badge above) runs all three — typecheck, lint, and the Jest
suite — on every push and pull request.

## Release build

Building and shipping a signed APK is a deferred, execution-time step (not
run as part of this repo's automated setup):

1. Set the API URL (`https://shelfstock-jer2x.vercel.app`) in `eas.json`'s
   `build.preview.env.EXPO_PUBLIC_API_URL` before building — it ships with
   the placeholder `https://YOUR-RAILWAY-API-URL` by default.
2. Build the APK:

   ```bash
   eas build -p android --profile preview
   ```

3. Publish it as a GitHub Release:

   ```bash
   gh release create v1.0.0 ./shelfstock-companion.apk \
     --title "ShelfStock Companion v1.0.0" \
     --notes "Admin companion app for ShelfStock: order management with push notifications, barcode-scan inventory, offline read caching. Install the APK on Android 8+."
   ```
