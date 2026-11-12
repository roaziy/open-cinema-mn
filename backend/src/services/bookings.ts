import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import type { AppDeps } from '../app';
import type { Db } from '../db/client';
import {
  bookings,
  branches,
  halls,
  movies,
  payments,
  seatHolds,
  seats,
  showtimes,
  tickets,
  users,
} from '../db/schema';
import { env } from '../env';
import { isDraining } from '../lib/drain';
import { badRequest, conflict, isUniqueViolation, notFound } from '../lib/errors';
import { signLink, signQr } from '../lib/sign';
import { withTimeout } from '../lib/timeout';
import { bookingConfirmedEmail } from '../messages/templates';
import type { MockRaw } from '../payments/mock';
import {
  type BookingCreateBody,
  type BookingView,
  MAX_SEATS_PER_BOOKING,
  type SeatDelta,
  seatPrice,
} from '../shared';
import { heldCount, SLOT_COLUMNS, toBranch, toSlot, toSummary } from './catalog-views';
import { lockUserShowtime, SeatTakenError, type Tx } from './holds';
import { nonFreeSeats } from './seat-state';

type Deps = Pick<AppDeps, 'messages' | 'payments' | 'seatHub' | 'clock'>;

export type CreateBookingInput = {
  userId: string;
  isGuest: boolean;
  body: BookingCreateBody;
};

/**
 * Creates a pending booking from the caller's own holds and its invoice. Replaying the same
 * idempotency key returns the same booking, but only to the user who created it.
 * Returns the booking id.
 */
export async function createBooking(
  db: Db,
  deps: Deps,
  { userId, isGuest, body }: CreateBookingInput,
): Promise<string> {
  const contactEmail = body.contactEmail?.trim().toLowerCase() || null;
  if (isGuest && !contactEmail) throw badRequest('contact_email_required');
  const holdIds = [...new Set(body.holdIds)];
  if (holdIds.length > MAX_SEATS_PER_BOOKING) throw badRequest('too_many_seats');
  const key = body.idempotencyKey;

  const replay = async (): Promise<string | null> => {
    const [row] = await db
      .select({ id: bookings.id, userId: bookings.userId })
      .from(bookings)
      .where(eq(bookings.idempotencyKey, key))
      .limit(1);
    if (!row) return null;
    if (row.userId !== userId) throw conflict('idempotency_conflict');
    return row.id;
  };

  let bookingId = await replay();
  if (!bookingId) {
    const mine = await db
      .select({ showtimeId: seatHolds.showtimeId })
      .from(seatHolds)
      .where(and(inArray(seatHolds.id, holdIds), eq(seatHolds.userId, userId)));
    if (mine.length !== holdIds.length) throw conflict('holds_unavailable');
    const showtimeId = (mine[0] as { showtimeId: string }).showtimeId;
    if (mine.some((h) => h.showtimeId !== showtimeId)) throw badRequest('holds_mixed_showtimes');
    bookingId = await db.transaction((tx) =>
      createInTransaction(tx, {
        userId,
        showtimeId,
        holdIds,
        contactEmail,
        key,
        now: deps.clock(),
      }),
    );
  }
  await ensureInvoice(db, deps, bookingId);
  return bookingId;
}

async function createInTransaction(
  tx: Tx,
  a: {
    userId: string;
    showtimeId: string;
    holdIds: string[];
    contactEmail: string | null;
    key: string;
    now: Date;
  },
): Promise<string> {
  // The same lock holds, releases and bookings of one user take, so a double tap serialises.
  await lockUserShowtime(tx, a.userId, a.showtimeId);
  const existing = async () => {
    const [row] = await tx
      .select({ id: bookings.id, userId: bookings.userId })
      .from(bookings)
      .where(eq(bookings.idempotencyKey, a.key))
      .limit(1);
    if (row && row.userId !== a.userId) throw conflict('idempotency_conflict');
    return row?.id ?? null;
  };
  const replayed = await existing();
  if (replayed) return replayed;

  const [show] = await tx
    .select({
      status: showtimes.status,
      startsAt: showtimes.startsAt,
      priceStandard: showtimes.priceStandard,
      pricePremium: showtimes.pricePremium,
    })
    .from(showtimes)
    .where(eq(showtimes.id, a.showtimeId))
    .limit(1)
    .for('share');
  if (!show) throw notFound();
  if (show.status !== 'scheduled' || show.startsAt <= a.now) throw badRequest('showtime_closed');

  const holds = await tx
    .select()
    .from(seatHolds)
    .where(
      and(
        inArray(seatHolds.id, a.holdIds),
        eq(seatHolds.userId, a.userId),
        eq(seatHolds.showtimeId, a.showtimeId),
        gt(seatHolds.expiresAt, a.now),
        sql`${seatHolds.bookingId} is null`,
      ),
    )
    .for('update');
  if (holds.length !== a.holdIds.length) throw conflict('holds_unavailable');

  const seatIds = holds.map((h) => h.seatId).sort();
  // A stale hold on a seat that is already sold must never be invoiced.
  const sold = await tx
    .select({ seatId: tickets.seatId })
    .from(tickets)
    .where(
      and(
        eq(tickets.showtimeId, a.showtimeId),
        eq(tickets.status, 'valid'),
        inArray(tickets.seatId, seatIds),
      ),
    );
  if (sold.length > 0) throw new SeatTakenError(sold.map((t) => t.seatId));
  const kinds = await tx
    .select({ id: seats.id, kind: seats.kind })
    .from(seats)
    .where(inArray(seats.id, seatIds));
  const total = kinds.reduce((sum, s) => sum + seatPrice(s.kind, show), 0);
  const expiresAt = new Date(Math.min(...holds.map((h) => h.expiresAt.getTime())));

  const [created] = await tx
    .insert(bookings)
    .values({
      userId: a.userId,
      showtimeId: a.showtimeId,
      total,
      contactEmail: a.contactEmail,
      idempotencyKey: a.key,
      seatIds,
      expiresAt,
      createdAt: a.now,
    })
    .onConflictDoNothing({ target: bookings.idempotencyKey })
    .returning({ id: bookings.id });
  if (!created) {
    // A concurrent request of another user won the key.
    const winner = await existing();
    if (winner) return winner;
    throw conflict('idempotency_conflict');
  }
  await tx.update(seatHolds).set({ bookingId: created.id }).where(inArray(seatHolds.id, a.holdIds));
  return created.id;
}

/**
 * Creates the invoice once per booking. The provider is called outside any transaction (it may
 * be an HTTP call and must never hold a pooled connection); the unique index on
 * `payments.booking_id` makes a racing second call a no-op, and every caller reads the stored row.
 */
async function ensureInvoice(db: Db, deps: Deps, bookingId: string): Promise<void> {
  const has = () =>
    db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .limit(1)
      .then((r) => r.length > 0);
  if (await has()) return;
  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (b?.status !== 'pending') return;
  const inv = await withTimeout(
    deps.payments.createInvoice({
      bookingId,
      amount: b.total,
      description: `${env.APP_NAME} ${b.orderNo}`,
    }),
    PROVIDER_TIMEOUT_MS,
    'createInvoice',
  );
  // An invoice never outlives the seats it was issued for.
  const expiresAt = new Date(
    Math.min(inv.expiresAt.getTime(), (b.expiresAt ?? inv.expiresAt).getTime()),
  );
  const raw: MockRaw = {
    state: 'pending',
    qrText: inv.qrText,
    deeplinks: inv.deeplinks,
    expiresAt: expiresAt.toISOString(),
  };
  await db
    .insert(payments)
    .values({
      bookingId,
      provider: env.PAYMENT_PROVIDER,
      invoiceId: inv.invoiceId,
      amount: b.total,
      raw,
    })
    .onConflictDoNothing({ target: payments.bookingId });
}

const clampIso = (iso: string, cap: Date | null) =>
  cap && cap.getTime() < new Date(iso).getTime() ? cap.toISOString() : iso;

export async function bookingView(
  db: Db,
  bookingId: string,
  now: Date,
  userId?: string,
): Promise<BookingView> {
  const [row] = await db
    .select({
      booking: bookings,
      slot: { ...SLOT_COLUMNS, held: heldCount(now) },
      showStatus: showtimes.status,
      movie: movies,
      branch: branches,
    })
    .from(bookings)
    .innerJoin(showtimes, eq(showtimes.id, bookings.showtimeId))
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .innerJoin(branches, eq(branches.id, halls.branchId))
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) throw notFound();
  if (userId && row.booking.userId !== userId) throw notFound();
  const b = row.booking;
  const [payment] = await db.select().from(payments).where(eq(payments.bookingId, b.id)).limit(1);
  const ticketRows = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.bookingId, b.id))
    .orderBy(asc(tickets.createdAt), asc(tickets.id));
  const raw = payment?.raw as MockRaw | null | undefined;
  return {
    id: b.id,
    orderNo: b.orderNo,
    status: b.status,
    total: b.total,
    expiresAt: (b.expiresAt ?? b.createdAt).toISOString(),
    seatsLost: b.seatsLost,
    invoice:
      payment && raw && b.status === 'pending'
        ? {
            invoiceId: payment.invoiceId,
            qrText: raw.qrText,
            deeplinks: raw.deeplinks,
            expiresAt: clampIso(raw.expiresAt, b.expiresAt),
          }
        : null,
    ticketIds: ticketRows.map((t) => t.id),
    showtime: {
      ...toSlot(row.slot),
      movie: toSummary(row.movie),
      branch: toBranch(row.branch),
      status: row.showStatus,
    },
  };
}

type Outcome =
  | { kind: 'noop' }
  | { kind: 'paid'; seatIds: string[] }
  | { kind: 'failed'; freed: string[] };

/**
 * Settles a booking against its invoice. Idempotent and safe to call from the poll, the
 * provider callback and the sweeper at once: the booking row is locked for the whole decision.
 *  - provider says paid: tickets, hold cleanup and `paid`, all in one transaction;
 *  - seats lost (hold gone or taken, or the ticket index refuses): `failed`, `seatsLost`, refund;
 *  - still pending: nothing.
 * Publishing and the email happen after the commit.
 */
export async function confirmBooking(
  db: Db,
  bookingId: string,
  deps: Deps,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<void> {
  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!b || !['pending', 'expired'].includes(b.status)) return;
  const [p] = await db.select().from(payments).where(eq(payments.bookingId, bookingId)).limit(1);
  if (p?.status !== 'pending') return;

  const remote = await withTimeout(
    deps.payments.checkPayment(p.invoiceId),
    timeoutMs,
    'checkPayment',
  );
  if (remote === 'pending') return;

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // The booking row lock serialises every settle. No provider call happens in here.
    const [locked] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for('update');
    if (!locked) return { kind: 'noop' };
    if (!['pending', 'expired'].includes(locked.status)) return { kind: 'noop' };
    const [pay] = await tx.select().from(payments).where(eq(payments.id, p.id));
    if (pay?.status !== 'pending') return { kind: 'noop' };

    if (remote === 'failed') {
      await tx.update(payments).set({ status: 'failed' }).where(eq(payments.id, pay.id));
      const freed = await releaseBookingHolds(tx, bookingId);
      await tx.update(bookings).set({ status: 'failed' }).where(eq(bookings.id, bookingId));
      return { kind: 'failed', freed };
    }

    const holds = await tx
      .select()
      .from(seatHolds)
      .where(eq(seatHolds.bookingId, bookingId))
      .for('update');
    const held = new Set(holds.map((h) => h.seatId));
    const intact = locked.seatIds.length > 0 && locked.seatIds.every((id) => held.has(id));

    let issued = false;
    if (intact) {
      try {
        // Savepoint: a refused insert must not poison the outer transaction.
        await tx.transaction(async (sp) => {
          await sp.insert(tickets).values(
            locked.seatIds.map((seatId) => {
              const id = randomUUID();
              return {
                id,
                bookingId,
                showtimeId: locked.showtimeId,
                seatId,
                qrToken: signQr(id, locked.showtimeId),
              };
            }),
          );
        });
        issued = true;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }

    if (issued) {
      await tx.update(payments).set({ status: 'paid' }).where(eq(payments.id, pay.id));
      await tx.delete(seatHolds).where(eq(seatHolds.bookingId, bookingId));
      await tx
        .update(bookings)
        .set({ status: 'paid', paidAt: deps.clock() })
        .where(eq(bookings.id, bookingId));
      return { kind: 'paid', seatIds: locked.seatIds };
    }

    // Money was taken but the seats are gone. Record that a refund is owed (payment stays
    // `paid`); the refund itself runs after this commit and is retried by the sweeper.
    await tx.update(payments).set({ status: 'paid' }).where(eq(payments.id, pay.id));
    const freed = await releaseBookingHolds(tx, bookingId);
    await tx
      .update(bookings)
      .set({ status: 'failed', seatsLost: true })
      .where(eq(bookings.id, bookingId));
    return { kind: 'failed', freed };
  });

  if (outcome.kind === 'paid') {
    publishAll(
      deps,
      b.showtimeId,
      outcome.seatIds.map((seatId) => ({ seatId, state: 'sold' })),
    );
    await sendConfirmationEmail(db, bookingId, deps);
  } else if (outcome.kind === 'failed') {
    await publishFreed(db, deps, b.showtimeId, outcome.freed);
    await refundOwed(db, bookingId, deps);
  }
}

/**
 * Longest a provider call may take. Well under the refund claim TTL, so a hung call frees its
 * claim before anyone may take it over, and one hung call cannot stall the sweeper loop.
 */
export const PROVIDER_TIMEOUT_MS = 20_000;

/** A refund claim older than this is assumed dead (the process crashed mid-call). */
export const REFUND_CLAIM_TTL_MS = 2 * 60_000;

/**
 * Pays back a failed or cancelled booking whose payment is still `paid`. Runs outside any
 * transaction; a provider error is logged and the sweeper tries again. Safe to call repeatedly
 * and concurrently: the payment row is claimed (`refunding`) before the provider is called, so
 * the cancel loop and the sweeper never both call it. Once draining it starts no refund and leaves
 * the payment owed (unclaimed) for the first sweep after the restart.
 */
export async function refundOwed(
  db: Db,
  bookingId: string,
  deps: Deps,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<void> {
  const now = deps.clock();
  const stale = new Date(now.getTime() - REFUND_CLAIM_TTL_MS);
  const [owed] = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(
      and(
        eq(payments.bookingId, bookingId),
        inArray(bookings.status, ['failed', 'cancelled']),
        inArray(payments.status, ['paid', 'refunding']),
      ),
    );
  if (!owed) return;
  // Before the claim, so the payment stays owed; after the lookup, so only real deferrals log.
  if (isDraining()) {
    console.warn(`draining: refund of ${bookingId} left to the sweeper`);
    return;
  }
  const [p] = await db
    .update(payments)
    .set({ status: 'refunding', refundClaimedAt: now })
    .where(
      and(
        eq(payments.id, owed.id),
        or(
          eq(payments.status, 'paid'),
          and(eq(payments.status, 'refunding'), lt(payments.refundClaimedAt, stale)),
        ),
      ),
    )
    .returning();
  if (!p) return;
  try {
    await withTimeout(deps.payments.refund(p.invoiceId), timeoutMs, 'refund');
    // Only the owner of this claim may settle it; a taken-over call must not touch the new owner's.
    await db
      .update(payments)
      .set({ status: 'refunded', refundedAt: deps.clock() })
      .where(ownClaim(p.id, now));
  } catch (err) {
    console.error('refund failed, will retry', err);
    await db
      .update(payments)
      .set({ status: 'paid', refundClaimedAt: null })
      .where(ownClaim(p.id, now));
  }
}

const ownClaim = (paymentId: string, claimedAt: Date) =>
  and(
    eq(payments.id, paymentId),
    eq(payments.status, 'refunding'),
    eq(payments.refundClaimedAt, claimedAt),
  );

async function releaseBookingHolds(tx: Tx, bookingId: string): Promise<string[]> {
  const gone = await tx
    .delete(seatHolds)
    .where(eq(seatHolds.bookingId, bookingId))
    .returning({ seatId: seatHolds.seatId });
  return gone.map((g) => g.seatId);
}

const publishAll = (deps: Deps, showtimeId: string, changes: SeatDelta[]) =>
  deps.seatHub.publish(showtimeId, changes);

/** Publishes the real state of seats whose hold just went away (a seat may be held again). */
async function publishFreed(db: Db, deps: Deps, showtimeId: string, seatIds: string[]) {
  if (seatIds.length === 0) return;
  const taken = await nonFreeSeats(db, showtimeId, deps.clock());
  publishAll(
    deps,
    showtimeId,
    seatIds.map((seatId) => ({ seatId, state: taken.get(seatId) ?? 'free' })),
  );
}

/** Never throws: a failed email must not undo a paid booking; the ticket is in the app. */
async function sendConfirmationEmail(db: Db, bookingId: string, deps: Deps): Promise<void> {
  try {
    const [row] = await db
      .select({
        booking: bookings,
        userEmail: users.email,
        verifiedAt: users.emailVerifiedAt,
        movieTitle: movies.title,
        branchName: branches.name,
        hallName: halls.name,
        startsAt: showtimes.startsAt,
      })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.userId))
      .innerJoin(showtimes, eq(showtimes.id, bookings.showtimeId))
      .innerJoin(halls, eq(halls.id, showtimes.hallId))
      .innerJoin(branches, eq(branches.id, halls.branchId))
      .innerJoin(movies, eq(movies.id, showtimes.movieId))
      .where(eq(bookings.id, bookingId))
      .limit(1);
    if (!row) return;
    const to = row.verifiedAt && row.userEmail ? row.userEmail : row.booking.contactEmail;
    if (!to) return;
    const seatRows = await db
      .select({ rowLabel: seats.rowLabel, number: seats.number })
      .from(seats)
      .where(inArray(seats.id, row.booking.seatIds))
      .orderBy(asc(seats.rowLabel), asc(seats.number));
    const mail = bookingConfirmedEmail({
      orderNo: row.booking.orderNo,
      movieTitle: row.movieTitle,
      branchName: row.branchName,
      hallName: row.hallName,
      seats: seatRows.map((s) => `${s.rowLabel}${s.number}`),
      startsAt: row.startsAt,
      total: row.booking.total,
      ticketUrl: `${env.WEB_PUBLIC_URL}/t/${signLink(bookingId)}`,
    });
    await deps.messages.email({ to, ...mail });
  } catch (err) {
    console.error('booking confirmation email failed', err);
  }
}
