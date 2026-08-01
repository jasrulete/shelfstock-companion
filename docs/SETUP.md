# One-time setup: what's left to do by hand

Everything in the codebase is implemented and tested, but a few steps need
your accounts (Expo, Firebase, GitHub, Railway) or a physical device, so
they were deliberately left for you. Do them in this order.

## 1. Backend: deploy + migrations (shelfstock repo)

The backend additions live on the `feature/companion-api` branch of the
shelfstock repo. After merging it into `main` (which deploys via Railway):

```bash
psql "$DATABASE_URL" -f backend/scripts/migrations/001-product-barcode.sql
psql "$DATABASE_URL" -f backend/scripts/migrations/002-device-tokens.sql
```

(Get `DATABASE_URL` from the Railway dashboard, or use `railway run`.)

Also check the Railway service's Node version: `expo-server-sdk@7` wants
Node >= 22.12. If needed, add `"engines": { "node": ">=22.12" }` to
`backend/package.json` or set `NIXPACKS_NODE_VERSION`.

## 2. GitHub repo for this app

```bash
gh repo create shelfstock-companion --public --source . --push
git push origin main
gh repo edit --default-branch main
```

Then open a PR from `feature/v1` to `main` — the CI workflow
(`.github/workflows/ci.yml`) runs on PRs and pushes to main.

## 3. Push notifications (all free)

1. `npx eas init` — creates/links a free Expo account and project; writes
   `extra.eas.projectId` into `app.json`.
2. Firebase console → create a project (no billing) → add an Android app
   with package `com.jeric.shelfstockcompanion` → download
   `google-services.json` into the repo root → in `app.json`, merge into
   the existing `android` block:
   ```json
   "android": { "googleServicesFile": "./google-services.json" }
   ```
3. Firebase console → Project settings → Service accounts → generate a
   service-account key JSON → `npx eas credentials` → Android → Google
   Service Account → upload the key (enables FCM v1 via Expo's push
   service).
4. Push does NOT arrive in Expo Go on Android — build a dev client:
   `npx expo run:android`, and use that build for push testing.
5. `google-services.json` contains no secrets — committing it is fine and
   keeps builds reproducible.

## 4. Manual end-to-end test (after steps 1-3)

On the dev-client app on a physical device, with `.env` pointed at the
deployed Railway API (or your LAN IP):

1. Log in — accept the notification-permission prompt. (Seed demo accounts
   with `scripts/seed-demo-users.js` in the shelfstock repo if needed.)
2. Place an order through the web storefront.
3. Phone shows "New order #N — $X" within seconds.
4. Tapping it opens that order's detail screen.
5. Settings → toggle notifications off → next order does not notify;
   toggle back on → it does again.
6. Scan flow: scan an unknown barcode → create-product screen with the
   code prefilled; scan it again → that product's edit screen.
7. Airplane mode → reopen the app → offline banner + cached lists render.

## 5. Release APK

1. Put your real Railway API URL into `eas.json` (`preview` profile,
   `EXPO_PUBLIC_API_URL` — it ships with a placeholder).
2. `npx eas build -p android --profile preview` (EAS free tier), download
   the APK.
3. Screenshots (login, orders, order detail, scanner, a push notification)
   into `docs/screenshots/`, referenced from the README.
4. ```bash
   git tag v1.0.0 && git push --tags
   gh release create v1.0.0 ./shelfstock-companion.apk --title "ShelfStock Companion v1.0.0" --notes "Admin companion app for ShelfStock: order management with push notifications, barcode-scan inventory, offline read caching. Install the APK on Android 8+."
   ```

## Known v1 tradeoffs (tracked for a fast follow-up)

- Clearing a nullable field (e.g. barcode) in the product edit form
  silently keeps the old value — the backend PUT uses COALESCE. Fix needs
  explicit-null support server-side or a form-side guard.
- Deep-link screens (`/orders/[id]`, `/products/*`, `/scan`) render a raw
  401 message instead of redirecting to login when opened logged-out
  (server still enforces auth — UX only).
- A device registered for push keeps receiving order notifications if its
  user's admin role is later revoked, until it logs out/unregisters.
- Orders list caps at 50 (no pagination yet).
