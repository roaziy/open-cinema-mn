import { type SeatKind, SeatKindSchema } from '@open-cinema/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();

export const userRole = pgEnum('user_role', ['guest', 'customer', 'staff', 'admin']);
// Same values as the shared contract so API and clients cannot drift apart.
export const seatKind = pgEnum('seat_kind', SeatKindSchema.options as [SeatKind, ...SeatKind[]]);
export const movieStatus = pgEnum('movie_status', ['now', 'soon', 'archived']);
export const showtimeFormat = pgEnum('showtime_format', ['2D', '3D', 'IMAX']);
export const showtimeStatus = pgEnum('showtime_status', ['scheduled', 'cancelled']);
export const bookingStatus = pgEnum('booking_status', [
  'pending',
  'paid',
  'failed',
  'expired',
  'cancelled',
]);
export const paymentStatus = pgEnum('payment_status', ['pending', 'paid', 'failed', 'refunded']);
export const ticketStatus = pgEnum('ticket_status', ['valid', 'cancelled']);
export const scanResult = pgEnum('scan_result', [
  'admitted',
  'repeat',
  'already_used',
  'wrong_branch',
  'wrong_day',
  'invalid',
  'undone',
]);

export const branches = pgTable('branches', {
  id: id(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    role: userRole('role').notNull().default('customer'),
    phone: text('phone'),
    email: text('email'),
    emailVerifiedAt: ts('email_verified_at'),
    passwordHash: text('password_hash'),
    name: text('name'),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: ts('locked_until'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_phone_unique').on(t.phone).where(sql`${t.phone} is not null`),
    uniqueIndex('users_email_unique').on(t.email).where(sql`${t.email} is not null`),
  ],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: id(),
    target: text('target').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('otp_codes_target_idx').on(t.target)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sessions_refresh_token_hash_unique').on(t.refreshTokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const halls = pgTable(
  'halls',
  {
    id: id(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    screenWidthM: doublePrecision('screen_width_m').notNull(),
    screenHeightM: doublePrecision('screen_height_m').notNull(),
    screenXM: doublePrecision('screen_x_m').notNull(),
    screenYM: doublePrecision('screen_y_m').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('halls_branch_idx').on(t.branchId)],
);

export const seats = pgTable(
  'seats',
  {
    id: id(),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'cascade' }),
    rowLabel: text('row_label').notNull(),
    number: integer('number').notNull(),
    xM: doublePrecision('x_m').notNull(),
    yM: doublePrecision('y_m').notNull(),
    zM: doublePrecision('z_m').notNull().default(0),
    kind: seatKind('kind').notNull().default('standard'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('seats_hall_row_number_unique').on(t.hallId, t.rowLabel, t.number)],
);

export const movies = pgTable('movies', {
  id: id(),
  title: text('title').notNull(),
  synopsis: text('synopsis').notNull().default(''),
  durationMin: integer('duration_min').notNull(),
  ageRating: text('age_rating').notNull(),
  genres: text('genres').array().notNull().default(sql`'{}'::text[]`),
  posterUrl: text('poster_url').notNull(),
  backdropUrl: text('backdrop_url'),
  trailerUrl: text('trailer_url'),
  tone: text('tone').notNull().default('#2E6BF0'),
  releaseDate: date('release_date', { mode: 'string' }).notNull(),
  status: movieStatus('status').notNull().default('soon'),
  createdAt: createdAt(),
});

export const showtimes = pgTable(
  'showtimes',
  {
    id: id(),
    movieId: uuid('movie_id')
      .notNull()
      .references(() => movies.id, { onDelete: 'restrict' }),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'restrict' }),
    startsAt: ts('starts_at').notNull(),
    format: showtimeFormat('format').notNull().default('2D'),
    priceStandard: integer('price_standard').notNull(),
    pricePremium: integer('price_premium').notNull(),
    status: showtimeStatus('status').notNull().default('scheduled'),
    createdAt: createdAt(),
  },
  (t) => [
    index('showtimes_hall_starts_idx').on(t.hallId, t.startsAt),
    index('showtimes_movie_starts_idx').on(t.movieId, t.startsAt),
  ],
);

export const bookings = pgTable(
  'bookings',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'restrict' }),
    status: bookingStatus('status').notNull().default('pending'),
    total: integer('total').notNull(),
    contactEmail: text('contact_email'),
    idempotencyKey: uuid('idempotency_key').notNull(),
    expiresAt: ts('expires_at'),
    seatsLost: boolean('seats_lost').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('bookings_idempotency_key_unique').on(t.idempotencyKey),
    index('bookings_user_idx').on(t.userId),
    index('bookings_status_expires_idx').on(t.status, t.expiresAt),
  ],
);

export const seatHolds = pgTable(
  'seat_holds',
  {
    id: id(),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'cascade' }),
    seatId: uuid('seat_id')
      .notNull()
      .references(() => seats.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('seat_holds_showtime_seat_unique').on(t.showtimeId, t.seatId),
    index('seat_holds_expires_idx').on(t.expiresAt),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    invoiceId: text('invoice_id').notNull(),
    status: paymentStatus('status').notNull().default('pending'),
    amount: integer('amount').notNull(),
    raw: jsonb('raw'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('payments_provider_invoice_unique').on(t.provider, t.invoiceId),
    index('payments_booking_idx').on(t.bookingId),
  ],
);

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'restrict' }),
    seatId: uuid('seat_id')
      .notNull()
      .references(() => seats.id, { onDelete: 'restrict' }),
    status: ticketStatus('status').notNull().default('valid'),
    qrToken: text('qr_token').notNull(),
    usedAt: ts('used_at'),
    usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    // Final guard against two valid tickets for one seat.
    uniqueIndex('tickets_showtime_seat_valid_unique')
      .on(t.showtimeId, t.seatId)
      .where(sql`${t.status} = 'valid'`),
    index('tickets_booking_idx').on(t.bookingId),
    index('tickets_qr_token_idx').on(t.qrToken),
  ],
);

export const ticketScans = pgTable(
  'ticket_scans',
  {
    id: id(),
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    deviceId: text('device_id').notNull(),
    scanId: uuid('scan_id').notNull(),
    result: scanResult('result').notNull(),
    previousScanId: uuid('previous_scan_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ticket_scans_scan_id_unique').on(t.scanId),
    index('ticket_scans_ticket_idx').on(t.ticketId),
  ],
);
