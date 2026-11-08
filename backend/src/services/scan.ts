import type { ScanResult, ScanResultCode } from '@open-cinema/shared';
import { ubDate, ubDayRange } from '@open-cinema/shared';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { halls, movies, seats, showtimes, ticketScans, tickets, users } from '../db/schema';
import { AppError, conflict, forbidden } from '../lib/errors';
import { verifyQr } from '../lib/sign';
import type { AuthUser } from '../middleware/auth';
import { SLOT_COLUMNS } from './catalog-views';

/** Same device re-scanning a ticket it just admitted, and the undo window, both 2 minutes. */
export const SCAN_WINDOW_MS = 2 * 60 * 1000;
export const RECENT_SCANS = 10;
const STAFF_FALLBACK_NAME = 'Ажилтан';

type Scanner = AuthUser;
type ScanRow = typeof ticketScans.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Db | Tx;

const UUID = z.string().uuid();

/** Serialises everything that touches one scan id, so a replay always sees the stored row. */
const lockScanId = (tx: Tx, scanId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scanId}, 0))`);

async function ticketCard(
  db: Reader,
  ticketId: string,
): Promise<NonNullable<ScanResult['ticket']>> {
  const [r] = await db
    .select({
      id: tickets.id,
      bookingId: tickets.bookingId,
      rowLabel: seats.rowLabel,
      number: seats.number,
      hallName: halls.name,
      title: movies.title,
      posterUrl: movies.posterUrl,
      tone: movies.tone,
      startsAt: showtimes.startsAt,
    })
    .from(tickets)
    .innerJoin(seats, eq(seats.id, tickets.seatId))
    .innerJoin(showtimes, eq(showtimes.id, tickets.showtimeId))
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .where(eq(tickets.id, ticketId));
  if (!r) throw new Error(`ticket ${ticketId} vanished`);
  const party = await db
    .select({ id: tickets.id })
    .from(tickets)
    .innerJoin(seats, eq(seats.id, tickets.seatId))
    .where(and(eq(tickets.bookingId, r.bookingId), eq(tickets.status, 'valid')))
    .orderBy(asc(seats.rowLabel), asc(seats.number));
  const index = party.findIndex((p) => p.id === r.id);
  return {
    id: r.id,
    seatCode: `${r.rowLabel}${r.number}`,
    hallName: r.hallName,
    movieTitle: r.title,
    posterUrl: r.posterUrl,
    tone: r.tone,
    startsAt: r.startsAt.toISOString(),
    partyIndex: index + 1,
    partySize: party.length,
  };
}

async function previousOf(db: Reader, id: string | null): Promise<ScanResult['previous']> {
  if (!id) return null;
  const [r] = await db
    .select({ at: ticketScans.createdAt, name: users.name })
    .from(ticketScans)
    .innerJoin(users, eq(users.id, ticketScans.staffId))
    .where(eq(ticketScans.id, id));
  if (!r) return null;
  // Never the phone number: this text is shown on a door card in front of guests.
  return { at: r.at.toISOString(), staffName: r.name ?? STAFF_FALLBACK_NAME, deviceLabel: null };
}

/**
 * The answer for a new scan row, built from live data once. It is stored with the row and every
 * later replay returns that stored copy, so later edits never change an answer already given.
 */
async function composeResult(
  db: Reader,
  v: {
    scanId: string;
    result: ScanResultCode;
    ticketId: string | null;
    previousScanId: string | null;
  },
  now: Date,
): Promise<ScanResult> {
  const showsTicket = v.ticketId !== null && v.result !== 'invalid';
  const showsPrevious = v.result === 'repeat' || v.result === 'already_used';
  return {
    scanId: v.scanId,
    result: v.result,
    ticket: showsTicket && v.ticketId ? await ticketCard(db, v.ticketId) : null,
    previous: showsPrevious ? await previousOf(db, v.previousScanId) : null,
    undoUntil:
      v.result === 'admitted' ? new Date(now.getTime() + SCAN_WINDOW_MS).toISOString() : null,
  };
}

async function storedScan(
  db: Reader,
  body: { scanId: string; token: string },
  staffId: string,
): Promise<ScanRow | null> {
  const [row] = await db.select().from(ticketScans).where(eq(ticketScans.scanId, body.scanId));
  if (!row) return null;
  // A scan id belongs to one staff member and one ticket.
  const sentTicket = verifyQr(body.token)?.ticketId;
  if (row.staffId !== staffId || (row.ticketId !== null && sentTicket !== row.ticketId)) {
    throw conflict('scan_id_conflict');
  }
  return row;
}

type Verdict = { result: ScanResultCode; ticketId: string | null; previousScanId?: string };

async function decide(
  tx: Tx,
  scanner: Scanner,
  body: { token: string; deviceId: string },
  now: Date,
): Promise<Verdict> {
  const parsed = verifyQr(body.token);
  if (!parsed || !UUID.safeParse(parsed.ticketId).success) {
    return { result: 'invalid', ticketId: null };
  }
  const [t] = await tx
    .select({
      id: tickets.id,
      status: tickets.status,
      showStatus: showtimes.status,
      showtimeId: tickets.showtimeId,
      startsAt: showtimes.startsAt,
      branchId: halls.branchId,
    })
    .from(tickets)
    .innerJoin(showtimes, eq(showtimes.id, tickets.showtimeId))
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .where(eq(tickets.id, parsed.ticketId));
  if (!t || t.showtimeId !== parsed.showtimeId) return { result: 'invalid', ticketId: null };
  if (t.status !== 'valid' || t.showStatus === 'cancelled')
    return { result: 'invalid', ticketId: t.id };
  if (scanner.role !== 'admin' && scanner.branchId !== t.branchId) {
    return { result: 'wrong_branch', ticketId: t.id };
  }
  if (ubDate(t.startsAt) !== ubDate(now)) return { result: 'wrong_day', ticketId: t.id };

  const admitted = await tx
    .update(tickets)
    .set({ usedAt: now, usedBy: scanner.id })
    .where(and(eq(tickets.id, t.id), eq(tickets.status, 'valid'), isNull(tickets.usedAt)))
    .returning({ id: tickets.id });
  if (admitted.length > 0) return { result: 'admitted', ticketId: t.id };

  const [last] = await tx
    .select()
    .from(ticketScans)
    .where(and(eq(ticketScans.ticketId, t.id), eq(ticketScans.result, 'admitted')))
    .orderBy(desc(ticketScans.createdAt))
    .limit(1);
  if (!last) {
    // Used with no admit on record: the ticket may have been cancelled after we read it.
    const [now2] = await tx
      .select({ status: tickets.status })
      .from(tickets)
      .where(eq(tickets.id, t.id));
    if (now2?.status !== 'valid') return { result: 'invalid', ticketId: t.id };
  }
  const sameDoor =
    last !== undefined &&
    last.deviceId === body.deviceId &&
    now.getTime() - last.createdAt.getTime() <= SCAN_WINDOW_MS;
  return { result: sameDoor ? 'repeat' : 'already_used', ticketId: t.id, previousScanId: last?.id };
}

/**
 * One scan attempt. The decision and its row commit together; a repeated `scanId` returns the
 * stored answer without touching the ticket, and a scan id owned by someone else is a conflict.
 */
export async function scanTicket(
  db: Db,
  scanner: Scanner,
  body: { token: string; scanId: string; deviceId: string },
  now: Date,
): Promise<ScanResult> {
  return db.transaction(async (tx) => {
    await lockScanId(tx, body.scanId);
    const existing = await storedScan(tx, body, scanner.id);
    if (existing) return existing.response;

    const v = await decide(tx, scanner, body, now);
    const previousScanId = v.previousScanId ?? null;
    const response = await composeResult(tx, { ...v, scanId: body.scanId, previousScanId }, now);
    const [row] = await tx
      .insert(ticketScans)
      .values({
        ticketId: v.ticketId,
        staffId: scanner.id,
        deviceId: body.deviceId,
        scanId: body.scanId,
        result: v.result,
        previousScanId,
        response,
        createdAt: now,
      })
      .returning({ response: ticketScans.response });
    if (!row) throw new Error('scan row missing');
    return row.response;
  });
}

/** Takes back an admit: same staff (or an admin), within the window, while that admit still stands. */
export async function undoScan(
  db: Db,
  scanner: Scanner,
  scanId: string,
  now: Date,
): Promise<ScanResult> {
  return db.transaction(async (tx) => {
    await lockScanId(tx, scanId);
    const [admit] = await tx.select().from(ticketScans).where(eq(ticketScans.scanId, scanId));
    if (
      admit?.result !== 'admitted' ||
      !admit.ticketId ||
      (scanner.role !== 'admin' && admit.staffId !== scanner.id)
    ) {
      throw forbidden('undo_forbidden');
    }
    // A repeated undo gets the answer it already had.
    const [done] = await tx
      .select()
      .from(ticketScans)
      .where(and(eq(ticketScans.previousScanId, admit.id), eq(ticketScans.result, 'undone')));
    if (done) return done.response;

    if (now.getTime() - admit.createdAt.getTime() > SCAN_WINDOW_MS) {
      throw new AppError(409, 'undo_expired');
    }
    const cleared = await tx
      .update(tickets)
      .set({ usedAt: null, usedBy: null })
      .where(and(eq(tickets.id, admit.ticketId), eq(tickets.usedAt, admit.createdAt)))
      .returning({ id: tickets.id });
    if (cleared.length === 0) throw new AppError(409, 'undo_expired');

    const undoScanId = crypto.randomUUID();
    const response = await composeResult(
      tx,
      { scanId: undoScanId, result: 'undone', ticketId: admit.ticketId, previousScanId: admit.id },
      now,
    );
    await tx.insert(ticketScans).values({
      ticketId: admit.ticketId,
      staffId: scanner.id,
      deviceId: admit.deviceId,
      scanId: undoScanId,
      result: 'undone',
      previousScanId: admit.id,
      response,
      createdAt: now,
    });
    return response;
  });
}

/** This staff member's last scans on one device, newest first. */
export async function recentScans(
  db: Db,
  staffId: string,
  deviceId: string,
): Promise<ScanResult[]> {
  const rows = await db
    .select({
      response: ticketScans.response,
      // An admit that was already taken back no longer offers Undo.
      undone: sql<boolean>`exists (select 1 from ticket_scans taken where taken.previous_scan_id = ticket_scans.id and taken.result = 'undone')`,
    })
    .from(ticketScans)
    .where(and(eq(ticketScans.staffId, staffId), eq(ticketScans.deviceId, deviceId)))
    .orderBy(desc(ticketScans.createdAt))
    .limit(RECENT_SCANS);
  return rows.map((r) => (r.undone ? { ...r.response, undoUntil: null } : r.response));
}

export type TodayShowtime = {
  id: string;
  startsAt: string;
  hallName: string;
  movieTitle: string;
  posterUrl: string;
  tone: string;
  admitted: number;
  sold: number;
  capacity: number;
};

/** Showtimes starting on the current Ulaanbaatar day, with door progress. */
export async function todayShowtimes(
  db: Db,
  now: Date,
  branchId: string | null,
): Promise<TodayShowtime[]> {
  const { start, end } = ubDayRange(ubDate(now));
  const rows = await db
    .select({
      id: showtimes.id,
      startsAt: showtimes.startsAt,
      hallName: SLOT_COLUMNS.hallName,
      capacity: SLOT_COLUMNS.capacity,
      sold: SLOT_COLUMNS.sold,
      admitted: sql<number>`(select count(*)::int from ${tickets} where ${tickets.showtimeId} = ${showtimes.id} and ${tickets.status} = 'valid' and ${tickets.usedAt} is not null)`,
      movieTitle: movies.title,
      posterUrl: movies.posterUrl,
      tone: movies.tone,
    })
    .from(showtimes)
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .where(
      and(
        eq(showtimes.status, 'scheduled'),
        sql`${showtimes.startsAt} >= ${start.toISOString()}::timestamptz and ${showtimes.startsAt} < ${end.toISOString()}::timestamptz`,
        branchId ? eq(halls.branchId, branchId) : undefined,
      ),
    )
    .orderBy(asc(showtimes.startsAt), asc(halls.name));
  return rows.map((r) => ({ ...r, startsAt: r.startsAt.toISOString() }));
}
