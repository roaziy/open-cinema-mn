import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  bookings,
  branches,
  halls,
  movies,
  seats,
  showtimes,
  ticketScans,
  tickets,
  users,
} from '../db/schema';
import { AppError, conflict, forbidden } from '../lib/errors';
import { verifyCheckCode, verifyQr } from '../lib/sign';
import type { AuthUser } from '../middleware/auth';
import type {
  AdminScan,
  AdminScanPage,
  AdminScanQuery,
  ScanBody,
  ScanResult,
  ScanResultCode,
  TodayShowtime,
} from '../shared';
import { ubBusinessDate, ubBusinessDayRange } from '../shared';
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
    .select({ at: ticketScans.createdAt, name: users.name, label: ticketScans.deviceLabel })
    .from(ticketScans)
    .innerJoin(users, eq(users.id, ticketScans.staffId))
    .where(eq(ticketScans.id, id));
  if (!r) return null;
  // Never the phone number: this text is shown on a door card in front of guests.
  return { at: r.at.toISOString(), staffName: r.name ?? STAFF_FALLBACK_NAME, deviceLabel: r.label };
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

/**
 * The ticket an order-number-and-seat scan points at. A door only sees its own branch's tickets
 * for today (business day, 05:00 to 05:00); `scope` is null only when matching a replay, which must find the same
 * ticket the first attempt did. Two matches mean we cannot tell, so none. The ticket's check
 * code must match as well (order numbers are sequential, so order and seat alone are guessable).
 */
async function resolveOrder(
  tx: Reader,
  body: { orderNo: string; seat: string; checkCode: string },
  scope: { scanner: Scanner; now: Date } | null,
): Promise<string | null> {
  const m = /^([A-Za-z]+)(\d+)$/.exec(body.seat);
  if (!m) return null;
  const conds = [
    // Stored upper-case, so this is a plain equality that the unique index serves.
    eq(bookings.orderNo, body.orderNo.toUpperCase()),
    sql`upper(${seats.rowLabel}) = ${(m[1] as string).toUpperCase()}`,
    eq(seats.number, Number(m[2])),
  ];
  if (scope) {
    const { start, end } = ubBusinessDayRange(ubBusinessDate(scope.now));
    conds.push(
      sql`${showtimes.startsAt} >= ${start.toISOString()}::timestamptz and ${showtimes.startsAt} < ${end.toISOString()}::timestamptz`,
    );
    // An admin works every branch; staff only their own, and a staff account without one sees none.
    if (scope.scanner.role !== 'admin') {
      if (!scope.scanner.branchId) return null;
      conds.push(eq(halls.branchId, scope.scanner.branchId));
    }
  }
  const rows = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .innerJoin(bookings, eq(bookings.id, tickets.bookingId))
    .innerJoin(seats, eq(seats.id, tickets.seatId))
    .innerJoin(showtimes, eq(showtimes.id, tickets.showtimeId))
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .where(and(...conds))
    .limit(2);
  const id = rows.length === 1 ? (rows[0]?.id ?? null) : null;
  // A wrong code looks exactly like a ticket that does not exist.
  return id && verifyCheckCode(id, body.checkCode) ? id : null;
}

async function storedScan(db: Reader, body: ScanBody, staffId: string): Promise<ScanRow | null> {
  const [row] = await db.select().from(ticketScans).where(eq(ticketScans.scanId, body.scanId));
  if (!row) return null;
  // A scan id belongs to one staff member and one ticket.
  const sentTicket =
    'token' in body ? verifyQr(body.token)?.ticketId : await resolveOrder(db, body, null);
  if (row.staffId !== staffId || (row.ticketId !== null && sentTicket !== row.ticketId)) {
    throw conflict('scan_id_conflict');
  }
  return row;
}

type Verdict = { result: ScanResultCode; ticketId: string | null; previousScanId?: string };

async function decide(tx: Tx, scanner: Scanner, body: ScanBody, now: Date): Promise<Verdict> {
  let parsed: { ticketId: string; showtimeId: string | null } | null;
  if ('token' in body) {
    parsed = verifyQr(body.token);
  } else {
    const id = await resolveOrder(tx, body, { scanner, now });
    parsed = id ? { ticketId: id, showtimeId: null } : null;
  }
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
  if (!t || (parsed.showtimeId !== null && t.showtimeId !== parsed.showtimeId)) {
    return { result: 'invalid', ticketId: null };
  }
  if (t.status !== 'valid' || t.showStatus === 'cancelled')
    return { result: 'invalid', ticketId: t.id };
  if (scanner.role !== 'admin' && scanner.branchId !== t.branchId) {
    return { result: 'wrong_branch', ticketId: t.id };
  }
  if (ubBusinessDate(t.startsAt) !== ubBusinessDate(now))
    return { result: 'wrong_day', ticketId: t.id };

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
  body: ScanBody,
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
        deviceLabel: body.deviceLabel ?? null,
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
      deviceLabel: admit.deviceLabel,
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

/** Showtimes of the current business day (05:00 to 05:00 UB), with door progress. */
export async function todayShowtimes(
  db: Db,
  now: Date,
  branchId: string | null,
): Promise<TodayShowtime[]> {
  const { start, end } = ubBusinessDayRange(ubBusinessDate(now));
  const rows = await db
    .select({
      id: showtimes.id,
      startsAt: showtimes.startsAt,
      hallName: SLOT_COLUMNS.hallName,
      branchId: halls.branchId,
      branchName: branches.name,
      capacity: SLOT_COLUMNS.capacity,
      sold: SLOT_COLUMNS.sold,
      admitted: sql<number>`(select count(*)::int from ${tickets} where ${tickets.showtimeId} = ${showtimes.id} and ${tickets.status} = 'valid' and ${tickets.usedAt} is not null)`,
      movieTitle: movies.title,
      posterUrl: movies.posterUrl,
      tone: movies.tone,
    })
    .from(showtimes)
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .innerJoin(branches, eq(branches.id, halls.branchId))
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .where(
      and(
        eq(showtimes.status, 'scheduled'),
        sql`${showtimes.startsAt} >= ${start.toISOString()}::timestamptz and ${showtimes.startsAt} < ${end.toISOString()}::timestamptz`,
        branchId ? eq(halls.branchId, branchId) : undefined,
      ),
    )
    .orderBy(asc(showtimes.startsAt), asc(branches.name), asc(halls.name));
  return rows.map((r) => ({ ...r, startsAt: r.startsAt.toISOString() }));
}

const SCANS_DEFAULT_LIMIT = 50;

const encodeCursor = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');

function decodeCursor(raw: string): { at: Date; id: string } | null {
  const [iso, id] = Buffer.from(raw, 'base64url').toString().split('|');
  const at = new Date(iso ?? '');
  return Number.isNaN(at.getTime()) || !id || !UUID.safeParse(id).success ? null : { at, id };
}

/**
 * Scan history for admins, newest first, one page at a time. `date` is a business day (05:00 to
 * 05:00 UB) of the moment the scan happened. A scan that matched no ticket belongs to its staff
 * member's branch, so branch filters still find it.
 */
export async function adminScans(db: Db, q: AdminScanQuery): Promise<AdminScanPage> {
  const limit = q.limit ?? SCANS_DEFAULT_LIMIT;
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  if (q.cursor && !cursor) throw new AppError(400, 'invalid_cursor');
  const scanBranch = sql<string | null>`coalesce(${halls.branchId}, ${users.branchId})`;
  const conds = [
    q.branchId ? sql`${scanBranch} = ${q.branchId}` : undefined,
    q.showtimeId ? eq(tickets.showtimeId, q.showtimeId) : undefined,
    q.result ? eq(ticketScans.result, q.result) : undefined,
  ];
  if (q.date) {
    const { start, end } = ubBusinessDayRange(q.date);
    conds.push(
      sql`${ticketScans.createdAt} >= ${start.toISOString()}::timestamptz and ${ticketScans.createdAt} < ${end.toISOString()}::timestamptz`,
    );
  }
  if (cursor) {
    conds.push(
      or(
        lt(ticketScans.createdAt, cursor.at),
        and(eq(ticketScans.createdAt, cursor.at), lt(ticketScans.id, cursor.id)),
      ),
    );
  }
  const rows = await db
    .select({
      id: ticketScans.id,
      at: ticketScans.createdAt,
      result: ticketScans.result,
      deviceLabel: ticketScans.deviceLabel,
      staffName: users.name,
      undone: sql<boolean>`exists (select 1 from ticket_scans taken where taken.previous_scan_id = ticket_scans.id and taken.result = 'undone')`,
      branchId: scanBranch,
      branchName: sql<string | null>`(select b.name from branches b where b.id = ${scanBranch})`,
      ticketId: tickets.id,
      rowLabel: seats.rowLabel,
      number: seats.number,
      orderNo: bookings.orderNo,
      hallName: halls.name,
      movieTitle: movies.title,
      showtimeId: showtimes.id,
      startsAt: showtimes.startsAt,
    })
    .from(ticketScans)
    .innerJoin(users, eq(users.id, ticketScans.staffId))
    .leftJoin(tickets, eq(tickets.id, ticketScans.ticketId))
    .leftJoin(seats, eq(seats.id, tickets.seatId))
    .leftJoin(bookings, eq(bookings.id, tickets.bookingId))
    .leftJoin(showtimes, eq(showtimes.id, tickets.showtimeId))
    .leftJoin(halls, eq(halls.id, showtimes.hallId))
    .leftJoin(movies, eq(movies.id, showtimes.movieId))
    .where(and(...conds))
    .orderBy(desc(ticketScans.createdAt), desc(ticketScans.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const items: AdminScan[] = page.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    result: r.result,
    undone: r.undone,
    staffName: r.staffName ?? STAFF_FALLBACK_NAME,
    deviceLabel: r.deviceLabel,
    ticket:
      r.ticketId && r.rowLabel !== null && r.showtimeId && r.startsAt
        ? {
            seatCode: `${r.rowLabel}${r.number}`,
            orderNo: r.orderNo ?? '',
            hallName: r.hallName ?? '',
            movieTitle: r.movieTitle ?? '',
            showtimeId: r.showtimeId,
            startsAt: r.startsAt.toISOString(),
          }
        : null,
    branchId: r.branchId,
    branchName: r.branchName,
  }));
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor(last.at, last.id) : null,
  };
}
