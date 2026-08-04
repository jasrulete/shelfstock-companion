# ShelfStock Companion — complete free setup guide

Everything below runs on free tiers. Total cost: **$0**. The only paid item
in the entire project is an optional Google Play listing ($25 one-time),
and this guide deliberately skips it — the app ships as an APK on GitHub
Releases instead.

## Cost reality check (read once)

| Thing | Cost | Notes |
| --- | --- | --- |
| GitHub public repo + Actions CI | $0 | Actions minutes are unlimited for public repos |
| GitHub Releases (APK hosting) | $0 | |
| Expo account + EAS Build | $0 | Free tier ≈ 30 cloud builds/month — plenty |
| Expo push notification service | $0 | No key, no billing |
| Firebase (FCM for Android push) | $0 | Spark plan; no credit card needed |
| Vercel (ShelfStock web + API, already live) | $0 | Hobby plan — the Express API now runs inside the Next.js deployment |
| Neon (ShelfStock Postgres) | $0 | Free tier |
| Google Play listing | $25 one-time | **Skipped.** APK on GitHub Releases is the free path. |
| iOS / App Store | $99/yr | **Skipped.** Out of scope for v1. |

Accounts you'll need (all free to create): GitHub (you have one),
[expo.dev](https://expo.dev), [Firebase console](https://console.firebase.google.com)
(any Google account).

---

## Step 0 — Try it right now (5 minutes, nothing to sign up for)

Everything except push notifications works in **Expo Go** against your
local backend:

1. Install **Expo Go** from the Play Store on your Android phone.
2. Start the backend (from the ShelfStock repo):
   ```bash
   docker compose up -d --build
   cd frontend && DATABASE_URL=postgres://postgres:postgres@localhost:5433/shelfstock npm run seed-demo-users
   ```
3. In this repo, point the app at your PC — create `.env`:
   ```bash
   cp .env.example .env
   ```
   and set `EXPO_PUBLIC_API_URL=http://<your-PC's-LAN-IP>:3000`
   (find it with `ipconfig`; phone and PC must be on the same wifi).
4. ```bash
   npm install
   npx expo start
   ```
   Scan the QR code with Expo Go. Log in with the seeded admin account.

You now have login, orders, status changes, inventory, search, product
editing, barcode scanning, and offline caching working. Push comes in
step 4 (it needs a dev build — Expo Go on Android can't receive remote
push).

---

## Step 1 — Publish the mobile repo on GitHub ✅ done

Live at **https://github.com/jasrulete/shelfstock-companion** with CI
green (typecheck + lint + tests run on every PR and push to main). Public
repos get unlimited Actions minutes.

## Step 2 — Update the production database FIRST (one command)

Your ShelfStock backend now runs **inside the Next.js app on Vercel** with
a **Neon** Postgres — there is no separate API service. Schema changes are
tracked, ordered migrations (`node-pg-migrate`) under `frontend/migrations/`;
the companion app's changes are one migration file that runs exactly once.

Grab `DATABASE_URL` from the Vercel project's environment variables (or
the Neon console), then from the ShelfStock repo:

```bash
cd frontend && DATABASE_URL="<your-neon-url>" npm run db:setup
```

**Do this BEFORE merging the PR.** The new code selects the `barcode`
column explicitly — deploying it against a database that doesn't have the
column yet would break the product listing until the schema catches up.
Schema-first has no such window: the extra column and table sit unused
until the code arrives.

## Step 3 — Merge the backend PR

The port for the new architecture is waiting at
**https://github.com/jasrulete/Shelfstock/pull/12** (it replaced the
pre-restructure #2) — all checks green and mergeable. Once step 2 is done,
merge it in the GitHub UI or:

```bash
gh pr merge 12 --repo jasrulete/Shelfstock --merge
```

Merging auto-deploys on Vercel. Two quick checks afterwards:

- `curl https://shelfstock-jer2x.vercel.app/api/health` → `{"status":"ok"}`
  (this endpoint touches the DB, so it also proves the schema step).
- In the Vercel project settings, make sure the **Node.js version is 22.x**
  — the push library (`expo-server-sdk@7`) wants Node ≥ 22.12.

Your mobile API URL is simply the Vercel URL:
`https://shelfstock-jer2x.vercel.app` — you need it in steps 4 and 6.

## Step 4 — Push notifications (Expo + Firebase, both free)

### 4a. Link the project to Expo

```bash
npx eas-cli login       # sign up free at expo.dev first if needed
npx eas-cli init        # writes extra.eas.projectId into app.json
```

### 4b. Firebase project (free Spark plan, no card)

1. [console.firebase.google.com](https://console.firebase.google.com) →
   **Add project** (analytics optional — disable it).
2. In the project: **Add app → Android**, package name exactly
   `com.jeric.shelfstockcompanion`.
3. Download **`google-services.json`** into this repo's root, and in
   `app.json` add to the existing `android` block:
   ```json
   "googleServicesFile": "./google-services.json"
   ```
   (It contains no secrets — commit it.)
4. **Project settings → Service accounts → Generate new private key** —
   downloads a JSON key. Keep this one PRIVATE (do not commit).
5. Hand that key to Expo's push service:
   ```bash
   npx eas-cli credentials
   ```
   → Android → your build profile → **Google Service Account** →
   **FCM V1** → upload the key file.

### 4c. Build a development client

Push does not work in Expo Go on Android, and the app skips push
registration on emulators — you need a **dev build on a physical phone**.
Two free ways; pick one:

**Easy (cloud, no Android SDK needed):**
```bash
npx eas-cli build -p android --profile development
```
When it finishes, open the build link on your phone, download the APK,
and install it (allow "install unknown apps" when prompted). Then run
`npx expo start --dev-client` on your PC and connect from the app.

**Local (if you have Android Studio + JDK 17 installed):**
```bash
npx expo run:android
```

## Step 5 — The end-to-end test (your phone, ~10 minutes)

With the dev build installed and `.env` pointed at the deployed API
(`https://shelfstock-jer2x.vercel.app`) or your LAN IP:

1. Log in as an admin — accept the notification-permission prompt.
2. Place an order in the web storefront ([shelfstock-jer2x.vercel.app](https://shelfstock-jer2x.vercel.app)).
3. Phone shows **"New order #N — $X"** within seconds.
4. Tap it → the app opens straight to that order. Mark it shipped.
5. Settings → toggle notifications **off** → new order → no notification.
   Toggle **on** → next order notifies again.
6. Inventory → **Scan** → scan any grocery barcode → unknown → the
   create-product screen opens with the code prefilled → save it →
   scan the same item again → its edit screen opens.
7. Airplane mode → kill and reopen the app → orange offline banner shows
   and your cached orders/products still render.

While you're here, **take the screenshots** for the README: login, orders
list, order detail, the scanner, and a real push notification. Drop them
into `docs/screenshots/` and reference them from README.md. A short
screen-recorded GIF of the scan flow is the single most impressive asset.

## Step 6 — Release APK on GitHub (the free "store")

1. Put the API URL (`https://shelfstock-jer2x.vercel.app`) into
   `eas.json` → `build.preview.env.EXPO_PUBLIC_API_URL` (it ships with a
   placeholder). Commit.
2. ```bash
   npx eas-cli build -p android --profile preview
   ```
   The `preview` profile produces an installable **APK** (not an AAB).
   Download it when the build finishes.
3. ```bash
   git tag v1.0.0
   git push --tags
   gh release create v1.0.0 ./shelfstock-companion.apk --title "ShelfStock Companion v1.0.0" --notes "Admin companion app for ShelfStock: order management with push notifications, barcode-scan inventory, offline read caching. Android 8+."
   ```
4. Link the release from the README so recruiters can install it in two
   taps.

Done. Web store + API + mobile app, publicly visible, CI-badged, $0 spent.

---

## Known v1 tradeoffs (tracked for a fast follow-up)

- Clearing a nullable field (e.g. barcode) in the product edit form
  silently keeps the old value — backend PUT uses COALESCE. Needs explicit
  null support server-side or a form-side guard.
- Deep-link screens (`/orders/[id]`, `/products/*`, `/scan`) show a raw
  401 message instead of redirecting to login when opened logged-out
  (server still enforces auth — UX only).
- A registered device keeps receiving pushes if its user's admin role is
  later revoked, until it logs out.
- Orders list caps at 50 (no pagination yet).

## If something misbehaves

- **App can't reach the API in Expo Go / dev build:** it's almost always
  the URL. Emulator → `http://10.0.2.2:3000`; physical phone → PC's LAN IP
  or `https://shelfstock-jer2x.vercel.app`. `EXPO_PUBLIC_*` vars are baked at start — restart
  `npx expo start` after editing `.env`.
- **No push arriving:** confirm you're on a dev build (not Expo Go), on a
  physical device, permission granted, the FCM V1 key is uploaded
  (`npx eas-cli credentials`), and the backend deploy + migration 002 both
  happened. Server logs print `Expo push send error:` on failures.
- **CI red on GitHub but green locally:** open the failing step's log —
  the three commands are exactly `npm run typecheck`, `npm run lint`,
  `npm test -- --ci`, so whatever fails there reproduces locally.
