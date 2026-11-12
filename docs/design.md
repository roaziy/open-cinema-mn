# Open Cinema: Design

Status: draft, 2026-11-08. Decisions marked **(owner)** were made by the project owner. Decisions marked **(builder call)** are defaults that can be overridden.

## 1. Intent

Open Cinema is an **open-source, self-hostable cinema booking platform** built for Mongolian cinemas. It is an open alternative to the closed, white-label systems that cinemas license today.

**One deployment = one cinema operator with many branches** **(owner)**. An operator (a chain such as Urgoo or Tengis, or a single-screen cinema) runs its own copy with its own branding, database and keys. Inside that copy it manages any number of branches, each with its own halls. Several operators means several deployments, not one shared server.

Why it exists:
- Mongolia has one modern cinema app (Urgoo Cinema, v6.x). It appears to be white-label, is rated 3.7★, and reviews complain about payment failures and sign-up friction. Other chains offer websites at best.
- No major cinema app worldwide offers a real **"view from your seat" preview** before buying. It exists only as third-party tools. This is Open Cinema's signature feature.
- The project should demonstrate production habits end to end, not a toy CRUD app.

## 2. Goals

1. A customer books in under a minute: movie → showtime → seats → pay → ticket. **No account needed:** the app is fully usable as a guest, and logging in is optional **(owner)**.
2. **Zero double-sold seats, enforced by the database** rather than by app logic.
3. The seat map updates live while someone is choosing.
4. A **3D view from the seat**, with real numbers: distance to the screen, how much of the view the screen fills, and an off-center angle.
5. The ticket is a QR code, plus an Apple Wallet pass and an Add to Calendar action with a 30-minute alarm.
6. Transactional email through wesend.mn: booking confirmation and showtime cancellation, sent to customers who added and verified an email.
7. An admin can run a cinema end to end: branches, halls with seat geometry, movies, showtimes, prices and sales reports.
8. Staff validate tickets at the door from a phone browser (PWA).
9. Production habits throughout: typed contracts shared by all apps, migrations in the repo, tests on the booking path, CI, no secrets in git, and a one-command self-host.

## 3. Non-goals (v1)

- Real QPay. A mock provider with the same shape as QPay ships first; real QPay comes later **(owner)**.
- Android polish. Android must work, using plain JS components, but is not tuned **(owner)**.
- Notifications of any kind: app push, Wallet pass updates, local reminders. Email covers transactional messages and the calendar alarm covers the reminder. Notifications are designed to be added later (see 16) **(owner)**.
- Subscriptions, food and drink ordering, split payments, seat change after booking.
- Redis, queues, microservices, Kubernetes.
- Multi-tenant SaaS. One deployment = one cinema operator with many branches (see 1) **(owner)**.
- App Store or TestFlight release. v1 runs as development builds on the owner's devices **(owner)**.
- Customers cancelling their own bookings. Only an admin cancelling a showtime triggers refunds (see 8.7) **(builder call)**.
- Demo logins or OTP bypasses. Demos use real SMS to the owner's phones **(builder call)**.

## 4. Anti-goals (failure even if it "works")

- A seat sold twice, under any timing.
- A customer charged without receiving a ticket, or receiving two tickets for one payment.
- Any secret in git: the Wallet signing certificate, the Apple Team ID, SMS keys or database URLs. The demo Wallet certificate belongs to a third-party organization, so a leak has real consequences.
- A 3D view that slows the seat map or blocks booking. It must stay optional and skippable.
- A generic template look. The bar is a polished, cinematic, iOS-native feel.

## 5. Users and surfaces

| Role | Surface | Login | Can do |
|---|---|---|---|
| Customer | iOS app (Expo SDK 58), Android works too | None (guest), or a one-time code by SMS (phone) or by email | Browse, book, pay, tickets, 3D seat view, Wallet, optional email for receipts |
| Staff | Web PWA (Next.js) | Phone + SMS OTP | Scan tickets for their branch, see today's showtimes |
| Admin | Web (same Next.js app) | Email + password | Everything in goal 7, plus creating staff accounts |

Admin and staff share one Next.js app with role-based routes **(builder call)**.

## 6. Architecture

```
Expo app (customer) ──┐
Next.js (admin+staff) ┼──> Express API (TypeScript) ──> PostgreSQL (Supabase)
                      │          ├──> wesend.mn (SMS OTP + email)
                      │          ├──> Payment provider (mock → QPay)
                      │          └──> passkit-generator (Wallet .pkpass)
```

**Repository layout** **(owner: stack; builder call: layout)**
```
app     Expo SDK 58, expo-router
web-admin      Next.js (App Router), admin + staff, PWA
backend        Express + TypeScript
zod schemas + inferred types: source in backend/src/shared, copied unchanged into mobile-app/src/shared and
web-admin/lib/shared (npm run sync:shared); each package is standalone
```

**Stack**

| Layer | Choice |
|---|---|
| Mobile | Expo SDK 58, expo-router. iOS: NativeTabs, glass effects, `@expo/ui` (liquid glass). Android: plain JS `.tsx` components **(owner)**. Reanimated, react-three-fiber + expo-gl (3D), expo-calendar, expo-secure-store |
| Web | Next.js App Router, PWA manifest + service worker, `barcode-detector` polyfill for QR scanning (iOS Safari ships the native API disabled) |
| API | Express + TypeScript **(owner)**, zod request validation, Drizzle ORM **(builder call)**, Server-Sent Events for live seats, `passkit-generator` |
| DB | PostgreSQL hosted on Supabase **(owner)**, used as a plain database (no Supabase Auth, Realtime or RLS). The API connects through the Supavisor **session pooler** (IPv4). Migrations live in the repo. |
| Hosting | **Backend** on a VPS the owner can use but does not administer (no database there): run with **pm2** (no Docker): `backend` is bundled with esbuild into `dist/index.js` (its own code, including `src/shared`, bundled) and pm2 runs `node dist/index.js`, behind the VPS's existing reverse proxy, domain `cinema-api.roaziy.cloud`. **web-admin** on Vercel (project root `web-admin/`), domain `cinema.roaziy.cloud`. **App** runs as a development build on the owner's devices. The database is Supabase only; backups use Supabase's own or a scheduled GitHub Action `pg_dump`, not the VPS **(owner)**. |
| CI | GitHub Actions: typecheck, lint, tests, gitleaks |

Package manager and test runner are left to the builder.

## 7. Domain model

```
users          id, role(guest|customer|staff|admin), phone?, email?, email_verified_at?, password_hash?, name?, branch_id? (staff), created_at
otp_codes      id, target (phone or email), code_hash, expires_at, attempts, created_at
sessions       id, user_id, refresh_token_hash, expires_at, revoked_at
branches       id, name, address, lat, lng
halls          id, branch_id, name, screen_width_m, screen_height_m, screen_x_m (center), screen_y_m (0)
seats          id, hall_id, row_label, number, x_m, y_m, z_m (floor height), kind(standard|premium|wheelchair|blocked)
movies         id, title, synopsis, duration_min, age_rating, genres[], poster_url, backdrop_url, trailer_url, release_date, status(now|soon|archived)
showtimes      id, movie_id, hall_id, starts_at, format(2D|3D|IMAX), price_standard, price_premium, status(scheduled|cancelled)
seat_holds     id, showtime_id, seat_id, user_id, booking_id?, expires_at      UNIQUE(showtime_id, seat_id)
bookings       id, user_id, showtime_id, status(pending|paid|failed|expired|cancelled), total, contact_email?, idempotency_key UNIQUE, created_at
payments       id, booking_id, provider, invoice_id, status(pending|paid|failed|refunded), amount, raw jsonb
tickets        id, booking_id, showtime_id, seat_id, status(valid|cancelled), qr_token, used_at?, used_by?
               UNIQUE(showtime_id, seat_id) WHERE status = 'valid'
ticket_scans   id, ticket_id?, staff_id, device_id, scan_id UNIQUE, result(admitted|repeat|already_used|wrong_branch|wrong_day|invalid|undone), created_at
```

Seat geometry is in meters, with the screen on the line y = 0 and x across the hall. `z_m` is the stepped floor height; the generator defaults to a rise of 0.15 m per row **(builder call)**. A hall's seats cannot be regenerated while any future showtime in it has valid tickets.

Posters and backdrops are uploaded by the admin to Supabase Storage (public bucket), and the URLs are stored on `movies` **(builder call)**. Storage is not covered by `pg_dump`; seeds can recreate demo media. The admin hall editor **generates** seats from rows, columns, seat pitch, row spacing and aisle gaps, then allows per-seat kind changes. It is not a freeform drag editor **(builder call)**.

## 8. Key flows

### 8.1 OTP login (customer, staff)
- Customers log in with **a phone (code by SMS) or an email (code by email)**, both sent through wesend.mn **(owner)**. Email is for visitors without a Mongolian number. A successful email login sets `email_verified_at`. Phone and email are each unique across users. Staff log in by phone only.
- 6-digit code, stored hashed, valid for 5 minutes, at most 5 attempts.
- Resend after 60 s. Rate limit: 5 codes per phone per hour, plus a per-IP limit.
- The dev SMS provider logs the code instead of sending it.
- Tokens: short-lived access JWT plus a rotating refresh token stored hashed **(builder call)**. Mobile stores them in SecureStore; the admin app uses httpOnly cookies.
- Staff accounts are created by an admin (phone + branch). An unknown phone that logs in becomes a customer.
- **Guests:** the app opens straight to Home with no login wall. On the first hold, `POST /auth/guest` creates a `users` row with role `guest` and returns the same token pair, so holds and bookings always have an owner. Guest creation is rate-limited per IP; guest sessions expire after 30 days. Turning a guest's bookings into an account after a later login is not in v1 **(builder call)**.

### 8.2 Admin login
- Email + password, hashed with argon2id. Lock out for 15 minutes after 5 failed attempts.

### 8.3 Booking
1. The customer opens a showtime. The app loads the seat map and subscribes to SSE `GET /showtimes/:id/seats/stream`.
2. **Hold:** `POST /showtimes/:id/holds {seatIds}`. In one transaction: delete expired holds for those seats, then insert. A unique violation means 409 "seat taken". The hold lasts 10 minutes, and a booking can have at most 10 seats **(builder call)**. Every change is broadcast over SSE.
3. **Gate (logged-out users only):** after seats, a sheet offers "Log in" (phone or email code) or "Continue as guest". A guest must enter an email, which is stored as `bookings.contact_email` and receives the receipt and a ticket link. The hold keeps counting down meanwhile **(owner)**.
4. **Checkout:** a countdown strip shows the hold's remaining time. `POST /bookings {holdIds, idempotencyKey}` creates a pending booking, then `createInvoice`.
5. **Pay** (mock provider: a fake bank screen with a "Pay" button). The app polls `checkPayment`. A callback route exists for real QPay.
6. **Confirm**, idempotent and in one transaction: mark the payment paid, insert the tickets (the unique index is the final guard), delete the holds, and set the booking to paid. If ticket insertion fails, mark the booking failed and refund through the provider (the mock records it).
7. A sweeper expires stale pending bookings and holds. Expired holds are also cleaned lazily during step 2.

### 8.4 Ticket
- The QR encodes a signed token (HMAC of ticket id + showtime id). The ticket stays readable offline once loaded.
- Guests also get a ticket link by email: `/t/:token` on the web app shows the QR and the Wallet button. The link token is its own HMAC, separate from the QR token.
- `GET /tickets/:id/pass` returns a `.pkpass` (eventTicket: movie, hall, seat, time, QR, `relevantDate`, branch location) signed with the Pass Type ID certificate from env. The app shows Apple's "Add to Apple Wallet" button.
- "Add to Calendar" uses expo-calendar and sets a calendar alarm 30 minutes before the showtime. This is the only reminder in v1: it needs no notification permission and no server **(builder call)**.

### 8.5 Staff scan
- The PWA camera decodes the QR and sends `POST /tickets/scan {token, scanId, deviceId}`. `scanId` is a client UUID per scan attempt; `deviceId` is a random id the PWA keeps in localStorage.
- Responses: admitted (atomically sets `used_at`), already used (with the time, door and staff), wrong branch, wrong day, or invalid. Every call writes one `ticket_scans` row.
- The result shows as a card over the live camera (green or red) with the seat code large; the camera stays on.

**No silent or accidental admits (owner).** A continuous web scanner can use up a ticket by accident (a QR read while the phone sweeps past, the same QR decoded on many frames, a request that succeeded but whose response was lost). The real scan a moment later would then show a false "already used" in front of the guest. Guards, cheapest first:
1. **Decode only on purpose.** Only codes inside the scan frame count, and the same value must decode on 3 frames in a row (about 300 ms) before it is sent.
2. **One read per code.** While a request or a result card is up, decoding pauses. Afterwards the same token is ignored for 5 s on that device.
3. **Never silent.** Every accepted read plays a sound (a different one for admit and reject) and vibrates where the browser supports it. iOS Safari has no vibration, so the "Start scanning" tap also unlocks Web Audio.
4. **Retries are idempotent.** A repeated `scanId` returns the stored result instead of scanning again, so a network retry can never turn into "already used".
5. **Same door, same ticket = repeat, not reject.** If the ticket was admitted by the same device within the last 2 minutes, the answer is `repeat` ("already admitted here at 19:12"), shown neutral rather than red. Only a scan from another device, or after 2 minutes, is a red "already used".
6. **Undo.** The admit card and the recent-scans strip offer "Undo" for 2 minutes. `POST /tickets/scan/:scanId/undo` (same staff only) clears `used_at` and writes an `undone` row. Admins see every scan and undo.
7. **Offline is not admit.** If the request fails, the card says "No connection, retrying" in neutral grey and never shows green. Offline admits are not supported in v1.

### 8.6 Payment provider interface
```ts
interface PaymentProvider {
  createInvoice(b: { bookingId: string; amount: number; description: string }):
    Promise<{ invoiceId: string; qrText: string; deeplinks: { name: string; url: string }[]; expiresAt: Date }>;
  checkPayment(invoiceId: string): Promise<'pending' | 'paid' | 'failed'>;
  refund(invoiceId: string): Promise<void>;
}
```
`MockPaymentProvider` ships in v1. The shape follows QPay's invoice → QR → check flow so `QPayProvider` can drop in later.

### 8.7 Showtime cancellation (admin)
- An admin cancels a showtime. In one transaction: the showtime becomes cancelled, its valid tickets become cancelled, and paid bookings become cancelled with a `refund` call per payment.
- Customers see "Cancelled, refunded" in My tickets, and get a cancellation email if they have a verified email (see 8.9).
- Editing a showtime's time or hall is blocked once tickets are sold; cancel it and create a new one instead.

### 8.8 Self-hosting config
- Every branding and endpoint value comes from env, not code. The mobile `app.config.ts` reads the app name, bundle ID, API URL and accent color. The API reads the Wallet pass type ID, team ID, certificate path and organization name.
- A different operator can rebuild everything with their own `.env`.
- The Wallet button only opens the pass URL; iOS shows the Add Pass sheet, so no native module is needed.

### 8.9 Email (wesend.mn)
- Sent with `POST https://api.wesend.mn/v1/email` (`to`, `subject`, `html` + `text`, `from_name`, `reply_to`), using the same API key as SMS **(owner)**. `from_name` and `reply_to` come from env, so each operator sends under its own name.
- **Adding an email:** optional, in Profile. It is verified with a 6-digit code sent by email, using the same rules as the phone OTP (8.1). A profile email receives nothing until verified. Exceptions: login codes, and a guest's `contact_email`, which receives only that booking's receipt and ticket link.
- **Emails in v1:** login codes, booking confirmation (order number, movie, branch, hall, seats, time, total, and a ticket link; for guests this is the `/t/:token` page) and showtime cancellation with the refund notice. The QR stays in the app and Wallet; the email is a receipt **(builder call)**.
- Sent only after the booking or cancellation transaction commits. A failed send is logged and never rolls back or blocks a booking; the ticket is always in the app. No outbox table in v1 **(builder call)**.
- All SMS and email go through one `messages` module with two senders: a dev sender that logs instead of sending, and the wesend sender. Push notifications can be added later as another channel in this module.
- Limits to know: wesend sends from its shared domain unless the operator buys the custom-domain add-on; HTML is sanitized (no scripts, forms or iframes), so templates use simple tables with inline styles; no attachments; HTML plus text must stay under 256 KB. A wesend sandbox key sends only to the owner's own verified phone and email.

## 9. 3D view from seat

Reference: the "view from seat" concept at x.com/oiharshit/status/2118369550295310675. The 2D map tilts into a 3D hall, the camera flies to the seat, and a card shows the numbers.

- **Scene is generated procedurally** from the `seats` and `halls` rows, so every hall gets it automatically with no 3D asset pipeline. It contains instanced seat meshes (selected seat highlighted), floor steps per row, side walls, and a screen plane textured with the movie backdrop.
- **Camera:** starts above the hall looking down (matching the 2D map), then animates to eye position `(x_m, y_m, 1.15 m)` looking at the screen center. Duration about 1.5 s with ease-in-out.
- **Entry:** a "Preview view" action on a selected seat. A crossfade from the 2D map is acceptable; a true 2D-to-3D morph is not required.
- **Stats card:**
  - distance `d` = distance from the seat to the screen center
  - screen fills `2·atan(W/2 / d)` of the horizontal view
  - off-center angle `atan(|x − screen_x| / d)`
  - Labels (tunable constants): view > 90° → "Very close to the screen"; 50–90° → "Close and immersive"; off-center > 20° → "Angled view"; otherwise "Balanced view".
- Wheelchair seats show their kind in the header.
- **Fallback:** if GL fails, show the stats card over a 2D diagram. Target 60 fps on iPhone 12 or newer **(builder call)**.
- The math lives in `shared` (copied into each package) with unit tests.

## 10. UI direction

- **Look:** dark only (no light mode), cinematic **(owner)**. One accent, screen blue `#2E6BF0` with white text on it **(owner)**, used only on the path to a ticket (primary CTA, selected seat, live state). The ticket and its QR sit on the only light surface, "paper" `#F2EDE4`. Tokens, components and screens live in the Figma file (Foundations page).
- **Type:** Gilroy **(owner)**. Gilroy is a commercial font, so its files are never committed to this public repo. The app loads them from a local path set in env, and public builds fall back to Onest (free, with Mongolian Cyrillic) **(builder call)**.
- **iOS:** liquid glass tab bar and sheets, SF Symbols. **Android:** plain JS equivalents.
- **Patterns** (researched across event, travel and cinema apps):

| Screen | Pattern |
|---|---|
| Home | Hero banner with pager, then poster rows (Now showing / Coming soon) |
| Movie detail | Poster hero, primary Book + secondary Trailer, meta line, sticky price/CTA bar |
| Showtimes | Day tabs, then showtimes grouped by branch as chips. No wheel pickers. |
| Seat map | Screen indicator, legend, states shown by color **and** shape, running total in the footer |
| Checkout | Hold countdown strip at the top, total repeated above the CTA |
| Ticket | Large white QR card, order number, Add to Apple Wallet |
| My tickets | Upcoming / Past segmented control, empty state with a CTA |
| Login | Optional, opened from the checkout gate or Profile. Phone / Email toggle, one field with Next disabled until valid, 6 auto-advancing OTP boxes, resend timer |
| Checkout gate | Sheet after seats for logged-out users: "Log in" or "Continue as guest" with an email field |

- Currency is MNT (₮). Times use Asia/Ulaanbaatar.

## 11. Security and privacy

- Secrets live only in `.env` on developer machines and the server. The repo ships `.env.example`. gitleaks runs in CI.
- Every request body is validated with zod. Every query is parameterized (via the ORM).
- Roles are checked on every route. Staff scans are limited to their own branch.
- Rate limits cover OTP (per phone or email, and per IP), guest creation, login and holds.
- Logs never contain OTP codes outside dev, nor tokens.
- The public repo carries no personal data. Seed users and cinemas are fictional; seed movies depend on the open question in 14.

## 12. Testing

- **API integration tests against a real Postgres:**
  - two concurrent holds on the same seat → exactly one succeeds
  - confirming a booking twice with the same idempotency key → one set of tickets
  - an expired hold can be taken by another user
  - a scanned ticket can't be scanned again
  - the same `scanId` sent twice returns the first result and writes no second admit
  - the same device scanning an admitted ticket within 2 minutes gets `repeat`, another device gets `already_used`
  - undo restores the ticket and a later scan admits it
  - a failed email send leaves the booking paid with its tickets
- **Unit tests:** view-angle math, OTP rules, QR token signing.
- **Mobile and admin:** typecheck + lint, plus manual test passes on an iOS Simulator and an iPhone.

## 13. Delivery phases

0. **De-risk spikes (throwaway):** a 3D hall scene in Expo with a camera fly-to-seat on a real iPhone, and a signed `.pkpass` that installs in Wallet. These are the two riskiest parts, so they are proven first **(builder call)**.
1. Foundation: standalone packages, shared schemas, DB schema + migrations, seed, auth (OTP + admin).
2. Admin: branches, hall generator, movies (with media upload), showtimes, prices, showtime cancellation.
3. Customer: browse, detail, showtimes, live seat map, holds.
4. Checkout (mock pay), tickets, QR, staff scan PWA, email (profile verification, confirmation, cancellation).
5. 3D view from seat (built on the phase 0 spike).
6. Wallet pass, Add to Calendar with alarm.
7. Admin sales and occupancy reports (per day, movie and hall). Deploy (VPS, Compose, reverse proxy), CI, README with screenshots. Check whether the VPS already runs a reverse proxy on ports 80/443; if so, add routes to it instead of adding Caddy.

Figma design for the customer app happens before phase 3's UI work.

## 14. Open questions (owner)

- License: MIT or AGPL-3.0.
- App languages: Mongolian, English, or both.
- Movie data: real titles and posters from TMDB (API key, attribution required) or hand-made fictional seeds.

## 15. Left to the builder

Package manager, test runner, logging library, component structure inside each app, exact animation timings, and the details of the admin report charts.

## 16. Future work (contributions welcome)

- **Wallet pass updates:** add `webServiceURL` + `authenticationToken` to the pass and implement Apple's pass web service (device registration and fetching the latest pass). Pushes go to APNs signed with the **same Pass Type ID certificate**, so no new credential is needed. Fields with a `changeMessage` show a lock-screen notice, for example "Showtime cancelled" or "Ticket used".
- **App push notifications:** needs the app's bundle ID with the Push capability on a paid Apple Developer team. It plugs in as a channel in the `messages` module.
- **Local reminders** (expo-notifications) as an alternative to the calendar alarm.
- Real QPay, Android polish, customer self-cancellation, App Store release (see 3).
