# ShelfStock Companion — v1 Design

**Date:** 2026-08-01
**Status:** Approved (pending final spec review)

## Purpose

A React Native (Expo, TypeScript) admin app for the existing ShelfStock
e-commerce platform. Store staff log in, manage orders, receive push
notifications when new orders arrive, and manage inventory by scanning
product barcodes with the phone camera.

Portfolio goal: demonstrate mobile-specific engineering (camera, push
notifications, offline-capable caching, store-ready builds) on top of an
existing full-stack TypeScript product — one coherent product spanning
web, API, and mobile.

**Hard constraint: everything must deploy and run for free.** The only
optional paid item is a Google Play developer account ($25 one-time),
and v1 ships without it.

## Architecture

Two codebases are touched:

1. **Mobile app** (this repo, `Mobile/shelfstock-companion`) — Expo app.
2. **Backend additions** (existing `shelfstock` repo) — small additive
   changes to the Express + PostgreSQL API. No breaking changes to the
   web storefront.

The mobile app is a pure API client. It talks to the same Express API the
Next.js frontend uses, authenticated with the existing JWT scheme
(7-day tokens, `role: admin` enforced by the existing `adminOnly`
middleware).

### Mobile stack

| Concern          | Choice                                   |
| ---------------- | ---------------------------------------- |
| Framework        | Expo (managed workflow) + TypeScript     |
| Navigation       | Expo Router (tabs + stacks)              |
| Server state     | TanStack Query with persistence          |
| Auth token       | `expo-secure-store`                      |
| Barcode scanning | `expo-camera` (built-in barcode support) |
| Push             | `expo-notifications` + Expo Push API     |

### Screens

- **Login** — email/password against `POST /api/auth/login`; rejects
  non-admin accounts with a clear message. Token stored in SecureStore;
  auto-login while the token is valid.
- **Orders tab** — list with status filter chips
  (pending / shipped / completed / cancelled), pull-to-refresh.
  Order detail shows items, quantities, snapshot prices, shipping info,
  totals, and status action buttons that follow the existing lifecycle:
  pending → shipped → completed, cancel where the backend allows it
  (via existing `PATCH /api/orders/:id/status`).
- **Inventory tab** — searchable product list. Product screen edits
  name, description, price, category, stock, image URL (existing
  `PUT /api/products/:id`). A prominent **Scan** button opens the camera:
  - Barcode found → opens that product.
  - Barcode unknown → opens "create product" with the barcode prefilled
    (`POST /api/products`).
- **Settings** — logout (also unregisters the device token),
  notifications on/off, app version.

### Push notification flow

1. After login, the app obtains an Expo push token and registers it:
   `POST /api/devices` (admin-only).
2. When `POST /api/orders` creates an order, the backend fires a push
   ("New order #123 — $45.00") to all registered admin devices via
   Expo's push API. Failure to send never fails the order request.
3. Tapping the notification deep-links to that order's detail screen.
4. Logout calls `DELETE /api/devices/:token`.

## Backend additions (shelfstock repo)

All additive; the web frontend is untouched.

1. **Schema:** `barcode VARCHAR UNIQUE NULL` on `products`;
   new `device_tokens` table (`id`, `user_id` FK, `token` unique,
   `created_at`).
2. **Endpoints:**
   - `GET /api/products/barcode/:code` — admin lookup, 404 when unknown.
   - `POST /api/devices` / `DELETE /api/devices/:token` — admin-only
     device token registration.
   - `POST /api/products` and `PUT /api/products/:id` accept an optional
     `barcode` field (409 on duplicates).
3. **Order hook:** after successful order creation, send Expo push to all
   registered devices (fire-and-forget with error logging).
4. **Tests:** vitest coverage for the new endpoints and the barcode
   uniqueness/lookup behavior, matching the existing test style.

## Offline behavior (deliberately scoped)

Reads (order list, product list, previously viewed details) are cached by
TanStack Query persistence and remain viewable offline, with a visible
"offline — showing cached data" banner. **Writes require a connection**
and fail with a clear retry message. A full offline write-queue/sync
engine is out of scope for v1 — it would roughly double the project for
little portfolio value.

## Error handling

- 401 → token expired/invalid → clear token, return to Login.
- 403 on login → "This app is for store admins."
- Network failures → non-blocking banner + retry affordances; cached data
  stays visible.
- Camera permission denied → inline explainer with a
  "grant in settings" link; inventory remains usable without scanning.
- Push permission denied → app fully usable; Settings shows notifications
  as off.

## Free-tier deployment plan

| Item          | How it stays free                                          |
| ------------- | ---------------------------------------------------------- |
| Backend + DB  | Reuses the existing Railway deployment; also runs fully    |
|               | locally via the existing docker-compose.                   |
| Push          | Expo Push API is free; Android delivery uses a free-tier   |
|               | Firebase project (config only, no billing account).        |
| Builds        | EAS Build free tier (~30/month); unlimited free local      |
|               | builds via `expo run:android` as fallback.                 |
| Distribution  | Signed APK on GitHub Releases (v1 ship target).            |
|               | Google Play listing is optional later ($25 one-time).      |
| iOS           | Out of scope (paid dev account); demos run via Expo Go.    |
| CI            | GitHub Actions free tier: typecheck, lint, tests.          |

## Ship criteria (definition of done)

1. App works end-to-end against the deployed Railway API: login, order
   management with push, barcode scan → edit/create product.
2. Signed release APK attached to a GitHub Release.
3. README with screenshots and a GIF of the scan flow, setup
   instructions, and architecture overview.
4. CI green: mobile repo (typecheck/lint/test) and existing shelfstock
   CI still passing with the backend additions.

## Out of scope for v1

Customer-facing features, analytics dashboards, offline write sync,
iOS App Store, multi-store support, role management UI.
