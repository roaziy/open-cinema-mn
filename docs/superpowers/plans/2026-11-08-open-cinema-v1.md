# Open Cinema v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the whole platform end to end — API, admin + staff web app (PWA), customer iOS app — running locally on dev/mock providers, so real credentials (Supabase, wesend.mn, Wallet certificate) can be plugged in afterwards with env only.

**Architecture:** npm-workspaces monorepo. `packages/shared` holds zod contracts and pure logic (seat-view math, hall generator, money/time) imported as TypeScript source by every app. `apps/api` is Express 5 + Drizzle on PostgreSQL with SSE for live seats. `apps/admin` is Next.js App Router acting as a BFF (tokens in httpOnly cookies, proxies to the API). `apps/mobile` is Expo SDK 58 with expo-router.

**Tech Stack:** Node 24, npm workspaces, TypeScript 5, zod, Express 5, Drizzle ORM + drizzle-kit + pg, jose, @node-rs/argon2, vitest, passkit-generator, Next.js (latest stable) + Tailwind v4, barcode-detector, Expo SDK 58 + expo-router + Reanimated + @tanstack/react-query + three/@react-three/fiber + expo-gl, Biome (lint/format for api, shared, admin), `npx expo lint` for mobile.

**Spec:** `docs/design.md` (read it before any task). Visual references: Figma file `L9FFZNfBkbiMBEVwdaOKGM` (layout only — the shipped UI follows "Visual language" below, which supersedes Figma's flat look).

## Global Constraints

- Repo is public and is the owner's own open-source project: README, comments and commit messages describe it only as Open Cinema, with no reference to where or why it was started.
- No secrets in git. Every secret comes from env; repo ships `.env.example` only. Wallet certificates, wesend key, Supabase keys, DB URLs never committed.
- Everything must run with **no credentials**: `MESSAGES_PROVIDER=dev` logs codes/emails, `PAYMENT_PROVIDER=mock`, `STORAGE_PROVIDER=local`, Wallet endpoint returns `503 {"error":"wallet_not_configured"}` when cert env is missing.
- Local Postgres 17 runs on `localhost:5432` (Homebrew). DBs: `open_cinema_dev`, `open_cinema_test`. Docker daemon is NOT running — no task may depend on Docker locally.
- Money is integer MNT (no decimals), displayed `₮15,000`. All dates stored UTC; all "day" logic in `Asia/Ulaanbaatar`.
- API base path `/v1`. JSON errors are `{ "error": "<snake_case_code>", "message"?: string }`.
- Limits (verbatim from spec): OTP 6 digits, hashed, 5 min TTL, max 5 attempts, resend after 60 s, 5 codes per target per hour + per-IP limit; admin lockout 15 min after 5 failures; hold 10 min; max 10 seats per booking; scan repeat window 2 min; undo window 2 min; client same-token ignore 5 s; 3 stable frames before send.
- Owner hates orange: no orange anywhere in UI (no `#F...` oranges, no amber CTAs).
- Customer app UI languages: Mongolian (default) + English, strings in one dictionary per app (`mn`, `en`). Admin/staff web: Mongolian only. **(builder call — spec Q14)**
- Seed data is fictional (6 original films, fictional branches/people). License: MIT. **(builder calls — spec Q14)**
- Gilroy (`GIP-*.otf`) is commercial: never committed. Apps use it only if files exist at a gitignored local path; otherwise Onest.
- Expo rule (AGENTS.md): before touching any Expo/RN API, read `apps/mobile/package.json` major version and the versioned docs `https://docs.expo.dev/versions/v58.0.0/`; never trust memory. Use `npx expo install <pkg>` for mobile deps. Never hand-edit `ios/`/`android/`.
- Commits: one local commit per task (`feat(scope): …`, conventional). Never push.

## Visual language (all UI tasks)

The previous Figma pass was judged flat and soulless. Soul comes from **identity color, layered depth and real content**, on a quiet dark base:

- **Base ramp (dark only):** canvas `#0B0B0D`, surface `#151517`, raised `#1D1D21`, fill `#26262B`, hairline `rgba(255,255,255,0.07)`, top inner highlight `rgba(255,255,255,0.05)` on raised panels. Text: ink `#F5F5F7`, body `#C7C7CC`, muted `#8E8E93`.
- **Action blue:** `#2E6BF0` (white text) — primary CTA, selected seat, live/selected states only.
- **Identity hues** (category/identity, never for actions): green `#30C46B`, red `#FF5A5F`, purple `#8B5CF6`, teal `#14B8A6`, yellow `#F5C542`, pink `#EC4899`, indigo `#5B6CFF`, sky `#38BDF8`. Each nav section, branch, hall, staff avatar and report series gets a stable hue. Status: success `#34D399`, danger `#F87171`, warning `#FBBF24`.
- **Filled icon tiles:** nav and list rows lead with a 26–30px rounded tile (radius 8) in an identity hue holding a **filled** white glyph (iOS Settings style). Line icons only for secondary/inline actions.
- **Icons:** iOS uses SF Symbols via `expo-symbols` (`.fill` variants in tiles). Web and Android use Phosphor (`@phosphor-icons/react`, `phosphor-react-native`): weight `fill` in tiles, `regular` elsewhere.
- **Layered depth:** rail → panel → card, each one surface step up, rounded 20 / 16 / 10 (nested radius = outer − padding), hairline borders, no drop shadows on dark except floating glass.
- **Alive details:** right-aligned quiet counts, tree connector lines for nested nav, small status dots (red = needs attention), progress bars, avatars (initials on hue), a footer account card.
- **Per-film tone:** `movies.tone` hex (seeded from poster). Used for: a blurred poster backdrop behind hero/detail (the image itself, not a gradient), the screen arc glow on the seat map, the ticket stub band, the 3D screen light. Chrome stays neutral.
- **Paper ticket:** QR and ticket stub on paper `#F2EDE4` with perforation + notches — the only light surface.
- **Motion:** seat tap spring (scale 0.92→1, 180 ms), sheets rise, totals tween, haptic on seat tap / payment success / scan result. No looping decoration.
- **Type:** Gilroy if present else Onest; weights 400/500/600 only; sentence case; tabular numbers.
- **Copy:** short, warm, specific Mongolian. No exclamation marks.

## Review Focus

1. **Hold expires between `POST /bookings` and payment confirm** — if the seats were re-taken, confirm must mark the booking `failed`, refund, and return a clear `seats_lost` state; never two tickets for one seat. (Task 8 test `confirm after hold expiry and re-take refunds`.)
2. **Ulaanbaatar midnight** — a 00:30 UB showtime belongs to that UB date in listings and in scan `wrong_day` checks, even though it is the previous UTC day. (Task 2 `ubDate` tests; Task 10 scan test.)
3. **Same person, different spelling** — `+976 9911 2045`, `99112045`, `97699112045` are one phone; `Bat@Mail.MN ` and `bat@mail.mn` are one email. (Task 5 normalization tests.)
4. **Double tap Pay / duplicate create** — two concurrent `POST /bookings` with one `idempotencyKey` yield one booking and one invoice. (Task 8 concurrent test.)
5. **SSE reconnect** — a client reconnecting after a drop must receive a full snapshot first, so stale seat colors cannot linger. (Task 6 test.)

---

## Phase A — Foundation

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json` (workspaces `apps/*`, `packages/*`; scripts `dev`, `typecheck`, `lint`, `test`, `db:migrate`, `db:seed`), `tsconfig.base.json` (strict, `moduleResolution: bundler`, `target: ES2022`), `biome.json`, `.gitignore` (node_modules, .env*, !.env.example, dist, .next, .expo, ios, android, apps/api/uploads, `**/fonts/private/`, `*.p12`, `*.pem`), `.env.example` (every var in Task 3 + Task 16 with empty/dummy values and a one-line comment each), `LICENSE` (MIT, "Open Cinema contributors"), `README.md` (stub: what it is, quick start placeholder), `.editorconfig`.
- Create: `packages/shared/package.json` (`"name": "@open-cinema/shared"`, `"exports": { ".": "./src/index.ts" }`, `"type": "module"`), `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`.

- [ ] **Step 1:** Create files; `npm install` at root succeeds.
- [ ] **Step 2:** `npm run typecheck` passes (empty shared). `npx biome check .` passes.
- [ ] **Step 3:** Commit `chore: monorepo scaffold`.

### Task 2: Shared logic and contracts

**Files:**
- Create: `packages/shared/src/money.ts`, `time.ts`, `seat-view.ts`, `hall-generator.ts`, `normalize.ts`, `schemas/{auth,catalog,booking,ticket,scan,admin}.ts`, `index.ts` re-exports.
- Test: `packages/shared/test/*.test.ts` (vitest; add `vitest` devDependency and `test` script).

**Interfaces (Produces — every app relies on these exact names):**
- `formatMnt(amount: number): string` → `"₮15,000"`.
- `TZ = 'Asia/Ulaanbaatar'`; `ubDate(d: Date | string): string` (`YYYY-MM-DD` in UB); `ubDayRange(date: string): { start: Date; end: Date }` (UTC instants); `formatUbTime(d: Date | string): string` (`"19:30"`).
- `normalizePhone(input: string): string | null` → `"+97699112045"` (8 digits MN mobile, accepts `+976`, `976`, spaces/dashes; else null). `normalizeEmail(input: string): string | null` (trim, lowercase, basic shape check).
- `EYE_HEIGHT_M = 1.15`, `SCREEN_BOTTOM_M = 1.2`; `type SeatViewLabel = 'very_close' | 'angled' | 'immersive' | 'balanced'`; `seatViewStats(seat: { x_m: number; y_m: number; z_m: number }, hall: { screen_width_m: number; screen_height_m: number; screen_x_m: number }): { distanceM: number; viewDeg: number; offCenterDeg: number; label: SeatViewLabel }`. Eye = `(x, y, z + 1.15)`, screen center = `(screen_x, 0, 1.2 + H/2)`, `distanceM` = 3D distance, `viewDeg = 2·atan((W/2)/d)`, `offCenterDeg = atan(|x − screen_x| / d)`. Label precedence: `view > 90 → very_close`, else `off > 20 → angled`, else `view ≥ 50 → immersive`, else `balanced`.
- `type SeatKind = 'standard' | 'premium' | 'wheelchair' | 'blocked'`; `type HallGenParams = { rows: number; seatsPerRow: number; seatPitchM: number; rowSpacingM: number; aisleAfter: number[]; firstRowDistanceM: number; risePerRowM: number }`; `type GeneratedSeat = { rowLabel: string; number: number; x_m: number; y_m: number; z_m: number; kind: SeatKind }`; `generateSeats(p: HallGenParams): GeneratedSeat[]` — row labels `A…`, numbering 1..n left→right, an aisle adds one `seatPitchM` gap after each listed seat number, x centered on 0, `y = firstRowDistanceM + r·rowSpacingM`, `z = r·risePerRowM`, all `standard`.
- zod schemas + inferred types (fields listed are the contract; names exact): see "Contract reference" at the end of this plan.

- [ ] **Step 1: Write failing tests**
```ts
expect(formatMnt(15000)).toBe('₮15,000');
expect(ubDate('2026-11-08T16:30:00Z')).toBe('2026-11-09'); // 00:30 UB next day
expect(formatUbTime('2026-11-08T11:30:00Z')).toBe('19:30');
expect(normalizePhone('+976 9911 2045')).toBe('+97699112045');
expect(normalizePhone('99112045')).toBe('+97699112045');
expect(normalizePhone('97699112045')).toBe('+97699112045');
expect(normalizePhone('12345')).toBeNull();
expect(normalizeEmail(' Bat@Mail.MN ')).toBe('bat@mail.mn');
const hall = { screen_width_m: 12, screen_height_m: 5.4, screen_x_m: 0 };
const a = seatViewStats({ x_m: 0, y_m: 9, z_m: 0.75 }, hall); // distance≈9.22, view≈66.1, off 0
expect(a.distanceM).toBeCloseTo(9.22, 2); expect(a.viewDeg).toBeCloseTo(66.1, 1); expect(a.label).toBe('immersive');
expect(seatViewStats({ x_m: 5, y_m: 3, z_m: 0 }, hall).label).toBe('angled');
expect(seatViewStats({ x_m: 0, y_m: 1, z_m: 0 }, hall).label).toBe('very_close');
expect(seatViewStats({ x_m: 0, y_m: 16, z_m: 2 }, hall).label).toBe('balanced');
const seats = generateSeats({ rows: 10, seatsPerRow: 12, seatPitchM: 0.55, rowSpacingM: 1, aisleAfter: [3, 9], firstRowDistanceM: 4, risePerRowM: 0.15 });
expect(seats).toHaveLength(120);
const at = (r: string, n: number) => seats.find(s => s.rowLabel === r && s.number === n)!;
expect(at('A', 1).x_m).toBeCloseTo(-3.575); expect(at('A', 12).x_m).toBeCloseTo(3.575);
expect(at('A', 4).x_m).toBeCloseTo(-1.375);
expect(at('F', 7).y_m).toBeCloseTo(9); expect(at('F', 7).z_m).toBeCloseTo(0.75);
```
- [ ] **Step 2:** `npm -w @open-cinema/shared test` → FAIL (not defined).
- [ ] **Step 3:** Implement the functions and schemas (use `Intl.DateTimeFormat` with `timeZone: TZ`; no date library).
- [ ] **Step 4:** Tests pass; typecheck passes.
- [ ] **Step 5:** Commit `feat(shared): money, time, normalize, seat view, hall generator, contracts`.

### Task 3: API skeleton, schema, migrations, test harness

**Files:**
- Create: `apps/api/package.json` (`@open-cinema/api`; scripts `dev` = `tsx watch src/index.ts`, `build` = `tsc`, `test` = `vitest run`, `db:generate`, `db:migrate`, `db:seed`), `tsconfig.json`, `drizzle.config.ts`, `src/env.ts`, `src/app.ts`, `src/index.ts`, `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `src/lib/errors.ts`, `src/lib/http.ts` (zod `validate(schema)` middleware, `asyncRoute`), `drizzle/` (generated SQL), `test/setup.ts`, `test/helpers.ts`, `test/health.test.ts`, `vitest.config.ts`.

**Interfaces (Produces):**
- `env` (zod-parsed `process.env`): `PORT=4000`, `DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET`, `QR_SECRET`, `LINK_SECRET`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, `CORS_ORIGINS` (comma list), `MESSAGES_PROVIDER` (`dev|wesend`), `WESEND_API_KEY?`, `WESEND_FROM_NAME`, `WESEND_REPLY_TO?`, `STORAGE_PROVIDER` (`local|supabase`), `SUPABASE_URL?`, `SUPABASE_SERVICE_ROLE_KEY?`, `SUPABASE_BUCKET?`, `PAYMENT_PROVIDER` (`mock`), `WALLET_PASS_TYPE_ID?`, `WALLET_TEAM_ID?`, `WALLET_ORG_NAME`, `WALLET_SIGNER_CERT_PATH?`, `WALLET_SIGNER_KEY_PATH?`, `WALLET_SIGNER_KEY_PASSPHRASE?`, `WALLET_WWDR_PATH?`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `NODE_ENV`.
- `createApp(deps?: Partial<AppDeps>): Express` — `AppDeps = { db, messages, payments, storage, clock: () => Date }` so tests inject fakes and a controllable clock.
- `db` (drizzle, `pg` Pool). Tables exactly as spec §7 plus: `users.failed_logins int default 0`, `users.locked_until timestamptz null`, `movies.tone text not null default '#2E6BF0'`, `bookings.expires_at timestamptz`, `bookings.seats_lost boolean default false`, `ticket_scans.previous_scan_id uuid null`, `seats` unique `(hall_id,row_label,number)`, `seat_holds` unique `(showtime_id,seat_id)`, `tickets` partial unique `(showtime_id,seat_id) where status='valid'`, `users` unique partial on `phone` and on `email` where not null, `otp_codes(target)` index. UUID PKs (`gen_random_uuid()`), `created_at timestamptz default now()` everywhere.
- Test helpers: `resetDb(): Promise<void>` (truncate all tables, restart identity), `makeTestApp(over?: Partial<AppDeps>)`, `fakeMessages()` (records `sent: {channel, to, subject?, body}[]`), `fixedClock(iso)` with `.advance(ms)`.

- [ ] **Step 1:** Failing test `GET /v1/health → 200 {ok:true, db:true}`.
- [ ] **Step 2:** Implement app (express 5, helmet, cors from `CORS_ORIGINS`, json limit 1mb, error handler mapping zod → 400 `validation_failed`, `AppError(status, code)` → JSON), schema, `drizzle-kit generate`, `migrate.ts` runs migrations. Global test setup creates/migrates `open_cinema_test` (create DB if missing via `pg` admin connection).
- [ ] **Step 3:** `npm -w @open-cinema/api test` passes; `npm -w @open-cinema/api run db:migrate` works against `open_cinema_dev`.
- [ ] **Step 4:** Commit `feat(api): skeleton, schema, migrations, test harness`.

### Task 4: Seed

**Files:** Create `apps/api/src/db/seed.ts`, `apps/api/seed/media/*.png` (6 posters, provided by the controller), `apps/api/src/storage/{index.ts,local.ts,supabase.ts}`.

**Interfaces:** `interface StorageProvider { put(key: string, body: Buffer, contentType: string): Promise<string /* public URL */> }`. `local` writes to `apps/api/uploads/` served at `/media/*` by the API; `supabase` uses `@supabase/supabase-js` `storage.from(bucket).upload` + `getPublicUrl`.

- [ ] Seed (idempotent: truncates domain tables in dev only, refuses when `NODE_ENV=production`): 3 branches (`Төв салбар`, `Зайсан салбар`, `Яармаг салбар`, real-looking UB addresses/lat-lng), each 2–4 halls generated with `generateSeats` (row J premium, A1/A12 wheelchair), 6 films (titles/meta from the Figma posters: Талын салхи, Шөнийн шугам, Мөсөн гол, Улаан морь, Бага хот, Дохио; synopses 2 sentences, `tone` per poster), showtimes for today + 6 days (UB), prices ₮12,000–₮18,000 standard, premium +₮7,000; admin from `SEED_ADMIN_EMAIL/PASSWORD`; 2 staff (fictional phones `+97688000001`, `+97688000002`) bound to Төв салбар.
- [ ] Test: `seed then GET /v1/movies?status=now returns ≥4 films with poster URLs`.
- [ ] Commit `feat(api): seed data and storage providers`.

## Phase B — API

### Task 5: Auth + messages

**Files:** `apps/api/src/lib/{tokens.ts,otp.ts,password.ts,rate-limit.ts}`, `src/messages/{index.ts,dev.ts,wesend.ts,templates.ts}`, `src/routes/auth.ts`, `src/middleware/auth.ts`, tests `test/auth.test.ts`.

**Interfaces (Produces):**
- `interface Messages { sms(to: string, text: string): Promise<void>; email(m: { to: string; subject: string; html: string; text: string }): Promise<void> }` — `dev` logs (codes visible only in dev), `wesend` POSTs `https://api.wesend.mn/v1/sms` / `/v1/email` with `Authorization: Bearer ${WESEND_API_KEY}` (body fields per research notes in this plan's appendix).
- `templates.ts`: `otpSms(code)`, `otpEmail(code)`, `bookingConfirmedEmail(view)`, `showtimeCancelledEmail(view)` → `{subject, html, text}` (table layout, inline styles, operator name from env).
- Routes: `POST /v1/auth/otp/request {channel:'sms'|'email', target}` → 204; `POST /v1/auth/otp/verify {channel, target, code}` → `AuthTokens`; `POST /v1/auth/guest` → `AuthTokens`; `POST /v1/auth/refresh {refreshToken}` → `AuthTokens` (rotate; reuse of a revoked token revokes the whole family); `POST /v1/auth/logout {refreshToken}` → 204; `POST /v1/auth/admin/login {email,password}` → `AuthTokens`; `GET /v1/me` → `PublicUser`; `PATCH /v1/me {name}`; `POST /v1/me/email {email}` (sends code) and `POST /v1/me/email/verify {code}`.
- Middleware `requireAuth`, `requireRole(...roles)`; `req.user: { id, role, branchId|null }`. Access JWT 15 min (HS256, `sub`, `role`), refresh 30 days random 32 bytes, stored SHA-256.
- Login by phone with unknown number → creates `customer`; staff phones must exist; email login sets `email_verified_at`. A guest that logs in gets a new user (no merge in v1).

- [ ] Tests (fixed clock, fake messages): code expires after 5 min; 6th attempt → 429 `too_many_attempts`; resend before 60 s → 429 `resend_too_soon`; 6th request in an hour → 429; phone normalization (Review Focus 3) maps three spellings to one user; email login sets verified; refresh rotation + reuse revokes family; admin lockout after 5 wrong passwords for 15 min (then success after `advance(15min)`); guest returns role `guest`; staff-only route rejects customer with 403.
- [ ] Commit `feat(api): otp, guest, admin auth, messages`.

### Task 6: Catalog + live seats (SSE)

**Files:** `src/routes/catalog.ts`, `src/lib/seat-hub.ts`, tests `test/catalog.test.ts`, `test/sse.test.ts`.

**Interfaces:** `GET /v1/branches`, `GET /v1/movies?status=now|soon`, `GET /v1/movies/:id`, `GET /v1/movies/:id/showtimes?date=YYYY-MM-DD` → `BranchShowtimes[]` (UB day, scheduled only, with `seatsLeft`), `GET /v1/showtimes/:id` → `SeatMap`, `GET /v1/showtimes/:id/seats/stream` (SSE). `SeatHub.publish(showtimeId, changes: { seatId: string; state: 'free'|'held'|'sold' }[])`; on connect the stream sends `event: snapshot` with all non-free seats, then `event: delta` messages; heartbeat comment every 20 s. In-process hub (`// ponytail: single instance; Postgres LISTEN/NOTIFY when scaling out`).

- [ ] Tests: showtimes grouped by branch for a UB date incl. a 00:30 UB show (Review Focus 2); SSE first message is a snapshot (Review Focus 5); delta arrives after a publish.
- [ ] Commit `feat(api): catalog and live seat stream`.

### Task 7: Seat holds

**Files:** `src/routes/holds.ts`, `src/services/holds.ts`, tests `test/holds.test.ts`.

**Interfaces:** `POST /v1/showtimes/:id/holds {seatIds}` (auth: any role) → `{ holds: Hold[] }` or `409 {error:'seat_taken', seatIds}`; `DELETE /v1/holds/:id` → 204; `GET /v1/showtimes/:id/holds/mine` → `Hold[]`. Service: `createHolds(db, {showtimeId, seatIds, userId, now}): Promise<Hold[]>` — one transaction: delete expired holds for those seats, reject seats with a valid ticket or `blocked` kind, insert; unique violation (`23505`) → `seat_taken`; user's active holds + new ≤ 10 else `400 too_many_seats`; showtime must be `scheduled` and in the future. Publishes `held`/`free` via SeatHub.

- [ ] Tests: two concurrent holds on one seat → exactly one 200 and one 409; an expired hold (advance 10 min) can be taken by another user; 11th seat → `too_many_seats`; blocked seat → 409; release publishes `free`.
- [ ] Commit `feat(api): seat holds`.

### Task 8: Bookings, mock payments, confirm, sweeper, emails

**Files:** `src/payments/{provider.ts,mock.ts}`, `src/services/bookings.ts`, `src/routes/bookings.ts`, `src/jobs/sweeper.ts`, tests `test/bookings.test.ts`.

**Interfaces:**
- `PaymentProvider` exactly as spec §8.6; `MockPaymentProvider` keeps invoices in the `payments` table (`raw` holds mock state), exposes `markPaid(invoiceId)` for the dev endpoint.
- `POST /v1/bookings {holdIds, idempotencyKey, contactEmail?}` → `BookingView` (guest must send `contactEmail`; logged-in users may omit). Same key → same booking (concurrent safe via unique `idempotency_key` + `ON CONFLICT DO NOTHING` then select). `bookings.expires_at` = earliest hold expiry.
- `GET /v1/bookings/:id` → `BookingView` (polling target; triggers `checkPayment` + `confirm` when pending).
- `POST /v1/bookings/:id/mock-pay` (only when `PAYMENT_PROVIDER=mock`) → marks invoice paid.
- `POST /v1/payments/callback/:provider` (stub for QPay, returns 204).
- `confirmBooking(db, bookingId, deps)`: idempotent single transaction — payment paid → insert tickets (`qr_token` = HMAC, see Task 9) → delete holds → booking `paid`. If ticket insert hits the partial unique index or holds were lost: booking `failed`, `seats_lost=true`, provider `refund`, payment `refunded`. After commit: SeatHub publish `sold`; email confirmation (to verified profile email or `contact_email`) — send failure is logged, never thrown.
- Sweeper `runSweep(db, now)` every 30 s: delete expired holds (publish `free`), pending bookings past `expires_at` → `expired`.

- [ ] Tests: confirm twice → one set of tickets; concurrent duplicate create (Review Focus 4) → one booking; confirm after hold expiry and re-take refunds (Review Focus 1); email failure leaves booking paid with tickets; sweeper expires pending booking and frees seats; guest without `contactEmail` → 400 `contact_email_required`.
- [ ] Commit `feat(api): bookings, mock payment, confirm, sweeper`.

### Task 9: Tickets, guest link, Wallet pass

**Files:** `src/lib/sign.ts`, `src/routes/tickets.ts`, `src/wallet/{pass.ts,model/OpenCinema.pass/(pass.json, icon.png, icon@2x.png, logo.png, logo@2x.png)}`, tests `test/tickets.test.ts`.

**Interfaces:** `signQr(ticketId, showtimeId): string` / `verifyQr(token): {ticketId, showtimeId} | null` (HMAC-SHA256 with `QR_SECRET`, base64url, format `oc1.<ticketId>.<showtimeId>.<mac>`); `signLink(bookingId)` / `verifyLink` (with `LINK_SECRET`); `signPassUrl(ticketId, now)` → `/v1/tickets/:id/pass?exp=…&sig=…` valid 5 min. Routes: `GET /v1/me/tickets?scope=upcoming|past` → `TicketView[]` grouped per booking; `GET /v1/tickets/:id` (owner) → `TicketView` incl. `qrToken`, `passUrl`; `GET /v1/t/:linkToken` (public) → `{ booking, tickets: TicketView[] }`; `GET /v1/tickets/:id/pass?exp&sig` → `application/vnd.apple.pkpass` via passkit-generator, or `503 wallet_not_configured` when cert env is missing. Pass: eventTicket, primary = movie title, secondary = hall/row/seat, auxiliary = time/branch, barcode QR = `qrToken`, `relevantDate` = starts_at, location = branch lat/lng, colors from base ramp, `foregroundColor` ink, `labelColor` muted.

- [ ] Tests: tampered QR → null; expired pass URL → 403; pass without cert env → 503; `/t/:token` works without auth and rejects tampered token.
- [ ] Commit `feat(api): tickets, guest link, wallet pass`.

### Task 10: Staff scan

**Files:** `src/services/scan.ts`, `src/routes/staff.ts`, tests `test/scan.test.ts`.

**Interfaces:** `POST /v1/staff/scan {token, scanId, deviceId}` (role staff/admin) → `ScanResult`; `POST /v1/staff/scan/:scanId/undo` → `ScanResult` (`undone`); `GET /v1/staff/scans/recent?deviceId` → last 10; `GET /v1/staff/today` → showtimes of the staff's branch for the UB day with `admitted`, `sold`, `capacity`. Rules exactly per spec §8.5: repeated `scanId` returns stored result; atomic `UPDATE tickets SET used_at=now, used_by=staff WHERE id=? AND status='valid' AND used_at IS NULL`; repeat if admitted by same `deviceId` within 2 min; wrong branch (staff `branch_id` ≠ hall's branch); wrong day (UB date of show ≠ UB today); cancelled ticket → `invalid`; undo only by the same staff within 2 min.

- [ ] Tests: same `scanId` twice → first result, one admit row; same device within 2 min → `repeat`; other device → `already_used` with previous `{at, staffName}`; after `advance(2min+1s)` same device → `already_used`; undo then rescan → `admitted`; wrong branch; wrong day across UB midnight (Review Focus 2); undo by another staff → 403.
- [ ] Commit `feat(api): staff scan with idempotency, repeat window, undo`.

### Task 11: Admin API

**Files:** `src/routes/admin/{branches,halls,movies,showtimes,staff,reports,uploads}.ts`, `src/services/showtimes.ts`, tests `test/admin.test.ts`.

**Interfaces:** All under `/v1/admin`, role admin. CRUD branches; halls `POST /halls {branchId, name, screen_width_m, screen_height_m, gen: HallGenParams}` (creates seats via `generateSeats`), `PUT /halls/:id/regenerate {gen}` (409 `hall_locked` if a future showtime has valid tickets), `PATCH /halls/:id/seats {changes: {seatId, kind}[]}`; movies CRUD + `POST /uploads` (multipart via `multer` memory, image/* ≤ 8 MB) → `{url}`; showtimes `POST` (no overlap in the same hall incl. 15-min cleaning gap → 409 `hall_busy`), `PATCH` (time/hall edits → 409 `showtime_locked` when tickets sold; price edits allowed), `POST /showtimes/:id/cancel` (spec §8.7, refunds + emails after commit); staff list/create/delete (phone + branch); `GET /reports?from&to&branchId` → `{ totals:{revenue, tickets, occupancy}, byDay:[], byMovie:[], byHall:[] }`; `GET /dashboard` → KPIs for today vs yesterday, hourly sales, top films, upcoming showtimes.

- [ ] Tests: customer gets 403; overlap → `hall_busy`; cancel refunds paid bookings and cancels tickets; edit locked after sale; regenerate locked; report revenue equals sum of paid bookings.
- [ ] Commit `feat(api): admin endpoints, reports, cancellation`.

## Phase C — Web (`apps/admin`)

### Task 12: Next.js shell, auth, alive sidebar, PWA

**Files:** `apps/admin/` (Next.js App Router, TS, Tailwind v4), `app/layout.tsx`, `app/globals.css` (`@theme` tokens from Visual language), `lib/api.ts` (server-side fetch to `API_INTERNAL_URL` with bearer from cookie, refresh on 401), `app/api/[...path]/route.ts` (proxy for client components), `app/login/page.tsx` (admin email+password), `app/staff/login/page.tsx` (phone + OTP), `middleware.ts` (role gate: `/admin/*` admin, `/staff/*` staff), `components/shell/{Sidebar,Rail,NavItem,AccountCard}.tsx`, `app/manifest.ts`, `public/sw.js`, fonts (`next/font/google` Onest; optional local GIP if `ADMIN_FONT_DIR` files exist).

- [ ] Sidebar per Visual language: hue icon tiles, groups ("Өнөөдөр", "Кино театр", "Баг", "Тайлан"), branch tree with connector lines and hue dots, counts (today's showtimes, live scans), account card, collapse button.
- [ ] Verify: `npm -w @open-cinema/admin run build` passes; login flows work against the local API (screenshot via Playwright or the browser pane).
- [ ] Commit `feat(admin): shell, auth, sidebar, pwa`.

### Task 13: Admin pages

**Files:** `app/admin/{page.tsx (dashboard), schedule, movies, movies/[id], halls, halls/[id], branches, staff, reports}/page.tsx` + components.

- [ ] Dashboard (KPI numbers with comparisons, one main hourly chart, top films ranked list with posters, upcoming table); schedule timeline per hall with now-line, create/edit/cancel drawer (cancel confirm shows refund count/amount); movies list + editor with poster/backdrop upload and tone picker (auto-suggest from poster); hall generator form with live seat preview (uses `generateSeats`) + side profile + per-seat kind painting; branches; staff (create by phone + branch); reports (date range, by day/movie/hall).
- [ ] Verify each page renders with seed data; build passes.
- [ ] Commit `feat(admin): dashboard, schedule, movies, halls, staff, reports`.

### Task 14: Staff PWA scanner

**Files:** `app/staff/{page.tsx (today), scan/page.tsx}`, `components/scan/{Scanner.tsx, useStableDecode.ts, ResultCard.tsx, RecentStrip.tsx, sounds.ts}`.

**Interfaces:** `useStableDecode(video, roi): { value: string | null }` — `barcode-detector` ponyfill, only codes whose bounding box center lies inside the ROI, emits after 3 identical consecutive frames; pauses while `busy`; ignores the last token for 5 s. `deviceId` from `localStorage['oc.deviceId']` (crypto.randomUUID once). Each send uses a new `scanId`; network failure → retry same `scanId` with backoff, UI grey "Сүлжээ алга, дахин оролдож байна".
- [ ] Result card over live camera (green admit with huge seat code + poster + undo for 2 min; neutral repeat; red already-used with who/when/door + "Менежер"/"Хаах"; red wrong branch/day/invalid). Distinct WebAudio tones (unlocked by "Эхлэх" tap), `navigator.vibrate` when available. Recent scans strip with status dots. Manual code entry fallback.
- [ ] Verify in the browser pane with a QR image on screen (seeded ticket) and against the API tests' rules.
- [ ] Commit `feat(admin): staff scanner pwa`.

### Task 15: Guest ticket page

**Files:** `app/t/[token]/page.tsx` (public, mobile-first): paper ticket(s) with QR (`qrcode` npm → SVG), seat, hall, time, branch map link, Add to Apple Wallet badge (official artwork slot `public/wallet-badge-mn.svg` — placeholder text button until the owner provides Apple's file).
- [ ] Commit `feat(admin): guest ticket page`.

## Phase D — Mobile (`apps/mobile`)

### Task 16: Expo scaffold, theme, i18n, API client, tabs

**Files:** `apps/mobile` created with the SDK 58 template (expo-router, `src/app`), `app.config.ts` (env: `APP_NAME`, `APP_BUNDLE_ID` default `cloud.roaziy.opencinema`, `EXPO_PUBLIC_API_URL`; embeds GIP via expo-font plugin only if `assets/fonts/private/GIP-*.otf` exist, else Onest from `assets/fonts/Onest-*.ttf`), `src/theme/{tokens.ts,type.ts}`, `src/i18n/{mn.ts,en.ts,index.ts}`, `src/lib/{api.ts,auth.ts,queries.ts,sse.ts}`, `src/app/_layout.tsx`, `src/app/(tabs)/_layout.tsx` (NativeTabs: Кино / Тасалбар / Профайл, SF Symbols `film.fill`, `ticket.fill`, `person.crop.circle.fill`; JS tabs on Android).
**Interfaces:** `api<T>(path, init?)` adds bearer, refreshes once on 401; `useAuth()` → `{ user, ensureGuest(), loginWithOtp(), logout() }` (tokens in SecureStore); `useSeatStream(showtimeId)` (uses `react-native-sse`, applies snapshot then deltas).
- [ ] Verify: `npx tsc --noEmit`, `npx expo lint`, app boots in the booted iPhone 17 simulator (iOS Simulator tool) showing tabs.
- [ ] Commit `feat(mobile): scaffold, theme, i18n, api client, tabs`.

### Task 17: Browse — Home, Movie, Showtimes

- [ ] Home: hero pager of now-showing (blurred poster backdrop in film tone), branch picker, poster rows (now / soon). Movie detail: poster hero, meta, synopsis, info card, sticky glass CTA. Showtimes: day chips (7 UB days), branch cards with time slots (few-left in warning yellow, sold-out struck).
- [ ] Verify in simulator with seed data; screenshot.
- [ ] Commit `feat(mobile): home, movie detail, showtimes`.

### Task 18: Seat map, holds, gate, login

- [ ] Seat map: screen arc glow in film tone, pinch/pan grid (Gesture Handler), seat states by color+shape, live via SSE, tap = hold (optimistic, rollback on 409 with haptic + toast), footer with chips/total/“Суудлаас харах”. Gate sheet for guests (log in vs continue as guest + email). Login modal: Утас/Имэйл toggle, field, 6 OTP boxes, resend timer.
- [ ] Verify: two simulators/clients — a hold in one shows in the other within 1 s.
- [ ] Commit `feat(mobile): live seat map, holds, gate, otp login`.

### Task 19: Checkout, pay, tickets, profile

- [ ] Checkout (hold countdown, order card, QPay method, receipt email row), mock QPay screen (QR + bank grid + test-mode "Төлсөн болгох"), success → Ticket screen (paper stub, QR, Add to Apple Wallet → open signed pass URL; Add to Calendar with 30-min alarm), My tickets (Upcoming/Past, cancelled-refunded badge), Profile (email add/verify, language mn/en, logout).
- [ ] Verify full booking in the simulator end to end against the local API.
- [ ] Commit `feat(mobile): checkout, mock pay, tickets, profile`.

### Task 20: 3D view from seat

- [ ] `src/features/seat-view/{SeatViewScreen.tsx, Hall3D.tsx, StatsCard.tsx}`: r3f + expo-gl; instanced seats from the seat map rows, stepped floor, side walls, screen plane textured with the film backdrop/poster, camera flies from top-down to `(x, y, z+1.15)` in 1.5 s ease-in-out; seat switcher for multiple selected seats; stats from `seatViewStats`; GL failure → 2D diagram + stats. 60 fps target.
- [ ] Verify in simulator (screenshot) and log frame time.
- [ ] Commit `feat(mobile): 3d view from seat`.

## Phase E — Ship

### Task 21: CI, Docker, deploy files, docs

**Files:** `.github/workflows/ci.yml` (Node 24, Postgres 17 service, `npm ci`, typecheck, biome, shared+api tests, admin build, mobile `tsc` + `expo lint`, gitleaks), `apps/api/Dockerfile`, `apps/admin/Dockerfile`, `deploy/docker-compose.yml`, `deploy/Caddyfile` (`cinema.roaziy.cloud`, `cinema-api.roaziy.cloud` via env), `README.md` (product pitch, screenshots slots, quick start, architecture, self-hosting), `docs/credentials.md` (what each credential is, where it goes in `.env`, how to obtain: Supabase pooler URL + storage bucket, wesend key/sender, Wallet Pass Type ID cert → PEMs, WWDR; checklist used in the joint credential session).
- [ ] Verify: `npm run typecheck && npm run lint && npm test` green locally; `docker compose config` valid (no daemon needed).
- [ ] Commit `chore: ci, docker, deploy, docs`.

### Task 22: Whole-branch review (Opus) and fixes

- [ ] Opus reviewer reads the spec, this plan and the full diff; reports defects ranked. Fix confirmed defects in a Sonnet pass; re-run all checks.
- [ ] Commit `fix: review findings`.

---

## Contract reference (packages/shared/src/schemas)

```
PublicUser { id, role: 'guest'|'customer'|'staff'|'admin', phone: string|null, email: string|null, emailVerified: boolean, name: string|null, branchId: string|null }
AuthTokens { accessToken, refreshToken, user: PublicUser }
Branch { id, name, address, lat, lng }
MovieSummary { id, title, posterUrl, backdropUrl|null, tone, ageRating, durationMin, genres: string[], status: 'now'|'soon', releaseDate }
MovieDetail extends MovieSummary { synopsis, trailerUrl|null }
ShowtimeSlot { id, startsAt (ISO), format: '2D'|'3D'|'IMAX', priceStandard, pricePremium, seatsLeft, capacity, hallName }
BranchShowtimes { branch: Branch, showtimes: ShowtimeSlot[] }
SeatState { id, rowLabel, number, x_m, y_m, z_m, kind: SeatKind, state: 'free'|'held'|'sold' }
SeatMap { showtime: ShowtimeSlot & { movie: MovieSummary, branch: Branch, status }, hall: { id, name, screen_width_m, screen_height_m, screen_x_m }, seats: SeatState[] }
SeatDelta { seatId, state: 'free'|'held'|'sold' }
Hold { id, seatId, showtimeId, expiresAt }
BookingCreateBody { holdIds: string[] (1..10), idempotencyKey: uuid, contactEmail?: string }
Invoice { invoiceId, qrText, deeplinks: { name, url }[], expiresAt }
BookingView { id, status: 'pending'|'paid'|'failed'|'expired'|'cancelled', total, expiresAt, seatsLost: boolean, invoice: Invoice|null, ticketIds: string[], showtime: SeatMap['showtime'] }
TicketView { id, bookingId, orderNo (e.g. 'OC-48213'), status: 'valid'|'cancelled', usedAt|null, seat: { rowLabel, number, kind }, hallName, showtime: { id, startsAt, format }, movie: MovieSummary, branch: Branch, qrToken, passUrl|null }
ScanBody { token, scanId: uuid, deviceId: uuid }
ScanResult { scanId, result: 'admitted'|'repeat'|'already_used'|'wrong_branch'|'wrong_day'|'invalid'|'undone', ticket: { id, seatCode ('F7'), hallName, movieTitle, posterUrl, tone, startsAt, partyIndex, partySize } | null, previous: { at, staffName, deviceLabel|null } | null, undoUntil: ISO|null }
```

## Appendix — verified library facts

(Filled in by the controller from research before Phase B/C/D dispatch. Implementers: treat as authoritative over memory; still read the linked docs when unsure.)

### Expo SDK 58 (verified against docs.expo.dev v58 + a working SDK 58 app)
- Versions: expo ~58.0.19, react 19.3.0, react-native 0.88.0, expo-router ~58.0.26, reanimated 4.7.1 (+ react-native-worklets 0.13.0), gesture-handler ~3.3.0, screens ~4.30.0, safe-area-context ~5.10.1, expo-image ~58.0.17, expo-blur ~58.0.5, expo-linear-gradient ~58.0.3, expo-glass-effect ~58.0.5, @expo/ui ~58.0.27, expo-font ~58.0.10, expo-calendar 58.0.6, expo-localization 58.0.5, expo-secure-store ~58.0.2, expo-haptics ~58.0.7, expo-gl 58.0.4, react-native-svg 15.16.0, react-native-qrcode-svg 6.3.21. Always install with `npx expo install`.
- NativeTabs: `import { NativeTabs } from 'expo-router/native-tabs'` (stable in 58). `<NativeTabs.Trigger name="index"><NativeTabs.Trigger.Icon sf="film.fill" /><NativeTabs.Trigger.Label>Кино</NativeTabs.Trigger.Label></NativeTabs.Trigger>`. iOS 26 draws the glass bar itself (backgroundColor ignored). Gate with `process.env.EXPO_OS === 'ios' && isLiquidGlassAvailable()`; otherwise a JS tab bar.
- Stack sheets: `presentation: 'formSheet'`, `sheetAllowedDetents: [0.5, 1] | 'fitToContents'`, `sheetGrabberVisible`, `sheetCornerRadius`. Android formSheet has no header — put titles in content.
- Glass: `import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'`; props `glassEffectStyle ('clear'|'regular')`, `isInteractive`, `tintColor`. Opacity < 1 on it or a parent kills the glass. Falls back to a plain View.
- @expo/ui: `import { Host, BottomSheet, Group } from '@expo/ui/swift-ui'`, modifiers from `'@expo/ui/swift-ui/modifiers'`; BottomSheet uses `isPresented` / `onIsPresentedChange`; detents via `<Group modifiers={[presentationDetents(['medium','large'])]}>`.
- Fonts: app config plugin `["expo-font", { "fonts": ["./assets/fonts/…"] }]`; iOS family name = the font's internal PostScript name (GIP files: `GIP-Regular`, `GIP-Medium`, `GIP-SemiBold`, `GIP-Bold`). Font changes need a native rebuild.
- Calendar: `Calendar.requestCalendarPermissions()`; alarm `{ relativeOffset: -30 }` (minutes). `createEventAsync` is deprecated in 58 — read https://docs.expo.dev/versions/v58.0.0/sdk/calendar/ for the instance `calendar.createEvent(details)` API before writing it.
- Localization: `getLocales()[0].languageCode`. SecureStore keys: alphanumeric, `.`, `-`, `_` only.
- Haptics: `impactAsync(ImpactFeedbackStyle.Light|Medium)`, `notificationAsync(NotificationFeedbackType.Success|Error)`, `selectionAsync()`.
- 3D: `@react-three/fiber` 9.x (peer: react >=19 <19.4, RN >=0.78, expo-gl, expo-asset, expo-file-system), `three` latest; `import { Canvas } from '@react-three/fiber/native'`. Add `glb,gltf,png,jpg` to metro assetExts and `cjs,mjs` to sourceExts if loaders are used. Simulator GL is unreliable — keep the 2D fallback solid.
- Monorepo: npm workspaces auto-configure Metro (SDK 52+); do not add watchFolders/nodeModulesPaths. Use root `overrides` for peer conflicts. Guide: https://docs.expo.dev/guides/monorepos/

### Backend + web (verified against npm/docs)
- Versions: express 5.3.x, express-rate-limit 8.7.x (`import { rateLimit } from 'express-rate-limit'`, option `limit`), helmet 8.x, cors 2.8.x, drizzle-orm 0.45.x, drizzle-kit 0.31.x, pg, jose 6.x, @node-rs/argon2 2.x (argon2id default; `hash`, `verify(hash, pw)`), vitest 5.x, passkit-generator 3.7.x, @supabase/supabase-js 2.x, next 16.x (React 19.x), tailwindcss 4.x + @tailwindcss/postcss, barcode-detector 3.x.
- Express 5: async errors auto-forward to `next(err)`; wildcards must be named (`/*splat`); `req.query` is a getter.
- Drizzle: `defineConfig({ dialect: 'postgresql', schema, out: './drizzle', dbCredentials: { url } })`; partial unique: `uniqueIndex('x').on(t.a, t.b).where(sql\`${t.status} = 'valid'\`)`; migrate: `migrate(db, { migrationsFolder })` from `drizzle-orm/node-postgres/migrator`; unique violation: drizzle 0.45 wraps errors in `DrizzleQueryError` — check `err.cause?.code === '23505'`.
- jose HS256: `new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('15m').sign(key)`; `jwtVerify(token, key, { algorithms: ['HS256'] })`; key = `new TextEncoder().encode(secret)`.
- vitest global setup: export `setup(project)` / `teardown()`; pass values with `project.provide()` + `inject()`.
- wesend SMS: `POST https://api.wesend.mn/v1/sms`, body `{ to: '99112233' /* 8-digit local, no +976 */, text }`, `Authorization: Bearer <key>`, optional `Idempotency-Key` header; 200 `{ id, status: 'sent', … }`; errors `{ error: { code, message } }` (402 insufficient_credits, 422 unsupported_number, 429 rate_limited with Retry-After, 502 provider_failed retryable). Cyrillic = 65 chars/segment, keep OTP SMS short. Email: `POST /v1/email` `{ to, subject, html, text, from_name, reply_to }` → 202 queued. Sandbox keys `ws_test_…` send only to the owner's verified contacts.
- passkit-generator: `import { PKPass } from 'passkit-generator'`; `await PKPass.from({ model: '<dir>.pass', certificates: { wwdr, signerCert, signerKey, signerKeyPassphrase } }, { serialNumber, description, …overrides })`; `pass.setBarcodes({ message, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' })`; `pass.getAsBuffer()`; model folder must end in `.pass` and contain `pass.json` + `icon.png`; serve `application/vnd.apple.pkpass`. Read the README for relevantDate/locations setters before using them.
- Next 16: `params`/`searchParams`/`cookies()`/`headers()` are async (await them); `middleware.ts` is now **`proxy.ts`**. Tailwind v4: `postcss.config.mjs` `{ plugins: { '@tailwindcss/postcss': {} } }`, CSS `@import "tailwindcss";` + `@theme { --color-…: … }`.
- barcode-detector: `import { BarcodeDetector } from 'barcode-detector/ponyfill'` (client component). zxing wasm loads from jsDelivr by default; for offline/CSP use `prepareZXingModule({ overrides: { locateFile } })` and serve the `.wasm` from `/public`. Pass a canvas/ImageData frame if `detect(video)` misbehaves.
- Supabase storage: `createClient(url, serviceRoleKey).storage.from(bucket).upload(path, buffer, { contentType, upsert: true })`, `getPublicUrl(path).data.publicUrl`; bucket must be public. DB: session pooler `postgresql://postgres.<ref>:<pw>@<pooler-host>:5432/postgres` (prepared statements OK in session mode).
