import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { bookings, halls, seatHolds, seats, showtimes, tickets } from '../db/schema';
import { conflict, isForeignKeyViolation, notFound } from '../lib/errors';
import type { SeatHub } from '../lib/seat-hub';
import type { AdminHall, AdminHallDetail, AdminSeat, HallGenParams, SeatKind } from '../shared';
import { generateSeats } from '../shared';
import type { Tx } from './holds';
import { nonFreeSeats } from './seat-state';

const INSERT_CHUNK = 1000;

const hallColumns = {
  id: halls.id,
  branchId: halls.branchId,
  name: halls.name,
  screenWidthM: halls.screenWidthM,
  screenHeightM: halls.screenHeightM,
  screenXM: halls.screenXM,
  // Literal names: Drizzle drops table qualifiers when a query has no join, which would make
  // the correlated `id` ambiguous.
  seatCount: sql<number>`(select count(*)::int from seats s where s.hall_id = halls.id)`,
  locked: sql<boolean>`exists (select 1 from tickets t inner join seats s on s.id = t.seat_id where s.hall_id = halls.id)`,
};

type HallRow = {
  id: string;
  branchId: string;
  name: string;
  screenWidthM: number;
  screenHeightM: number;
  screenXM: number;
  seatCount: number;
  locked: boolean;
};

const toHall = (h: HallRow): AdminHall => ({
  id: h.id,
  branchId: h.branchId,
  name: h.name,
  screen_width_m: h.screenWidthM,
  screen_height_m: h.screenHeightM,
  screen_x_m: h.screenXM,
  seatCount: h.seatCount,
  locked: h.locked,
});

async function insertSeats(tx: Tx, hallId: string, gen: HallGenParams): Promise<void> {
  const rows = generateSeats(gen).map((s) => ({
    hallId,
    rowLabel: s.rowLabel,
    number: s.number,
    xM: s.x_m,
    yM: s.y_m,
    zM: s.z_m,
    kind: s.kind,
  }));
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await tx.insert(seats).values(rows.slice(i, i + INSERT_CHUNK));
  }
}

export async function listHalls(db: Db, branchId?: string): Promise<AdminHall[]> {
  const rows = await db
    .select(hallColumns)
    .from(halls)
    .where(branchId ? eq(halls.branchId, branchId) : undefined)
    .orderBy(asc(halls.name));
  return rows.map(toHall);
}

export async function hallDetail(db: Db, id: string): Promise<AdminHallDetail> {
  const [hall] = await db.select(hallColumns).from(halls).where(eq(halls.id, id)).limit(1);
  if (!hall) throw notFound();
  const rows = await db
    .select()
    .from(seats)
    .where(eq(seats.hallId, id))
    .orderBy(asc(seats.yM), asc(seats.number));
  const list: AdminSeat[] = rows.map((s) => ({
    id: s.id,
    rowLabel: s.rowLabel,
    number: s.number,
    x_m: s.xM,
    y_m: s.yM,
    z_m: s.zM,
    kind: s.kind,
  }));
  return { ...toHall(hall), seats: list };
}

export async function createHall(
  db: Db,
  b: {
    branchId: string;
    name: string;
    screen_width_m: number;
    screen_height_m: number;
    gen: HallGenParams;
  },
): Promise<string> {
  return db.transaction(async (tx) => {
    // Seats are centred on x = 0, so the screen centre is 0 too.
    const [hall] = await tx
      .insert(halls)
      .values({
        branchId: b.branchId,
        name: b.name,
        screenWidthM: b.screen_width_m,
        screenHeightM: b.screen_height_m,
        screenXM: 0,
      })
      .returning({ id: halls.id });
    const id = (hall as { id: string }).id;
    await insertSeats(tx, id, b.gen);
    return id;
  });
}

/**
 * Replaces all seats of a hall. Refused once any ticket (of any status) ever referenced one of
 * its seats (`tickets.seat_id` is a restrict foreign key, and old tickets must keep their seat),
 * and while a customer is mid-purchase: an unexpired hold or a pending booking in the hall.
 */
export async function regenerateHall(
  db: Db,
  id: string,
  gen: HallGenParams,
  now: Date,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [hall] = await tx
        .select({ id: halls.id })
        .from(halls)
        .where(eq(halls.id, id))
        .for('update');
      if (!hall) throw notFound();
      const [used] = await tx
        .select({ id: tickets.id })
        .from(tickets)
        .innerJoin(seats, eq(seats.id, tickets.seatId))
        .where(eq(seats.hallId, id))
        .limit(1);
      if (used) throw conflict('hall_locked');
      const [held] = await tx
        .select({ id: seatHolds.id })
        .from(seatHolds)
        .innerJoin(seats, eq(seats.id, seatHolds.seatId))
        .where(and(eq(seats.hallId, id), gt(seatHolds.expiresAt, now)))
        .limit(1);
      const [pending] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .innerJoin(showtimes, eq(showtimes.id, bookings.showtimeId))
        .where(and(eq(showtimes.hallId, id), eq(bookings.status, 'pending')))
        .limit(1);
      if (held || pending) throw conflict('hall_locked');
      await tx.delete(seats).where(eq(seats.hallId, id));
      await insertSeats(tx, id, gen);
    });
  } catch (err) {
    // A ticket issued between the check and the delete trips the restrict key.
    if (isForeignKeyViolation(err)) throw conflict('hall_locked');
    throw err;
  }
}

/**
 * Sets seat kinds in a hall. A seat with a live ticket on an upcoming showing, or an unexpired
 * hold, cannot be blocked. Afterwards the changed seats' real state is pushed to open seat maps
 * of the hall's upcoming showings so clients refresh them.
 */
export async function changeSeatKinds(
  db: Db,
  seatHub: SeatHub,
  hallId: string,
  changes: { seatId: string; kind: SeatKind }[],
  now: Date,
): Promise<void> {
  const final = new Map(changes.map((c) => [c.seatId, c.kind]));
  const ids = [...final.keys()];
  await db.transaction(async (tx) => {
    const [hall] = await tx.select({ id: halls.id }).from(halls).where(eq(halls.id, hallId));
    if (!hall) throw notFound();
    const owned = await tx
      .select({ id: seats.id })
      .from(seats)
      .where(and(eq(seats.hallId, hallId), inArray(seats.id, ids)));
    if (owned.length !== ids.length) throw notFound('seat_not_found');

    const blocking = ids.filter((i) => final.get(i) === 'blocked');
    if (blocking.length > 0) {
      const sold = await tx
        .select({ id: tickets.id })
        .from(tickets)
        .innerJoin(showtimes, eq(showtimes.id, tickets.showtimeId))
        .where(
          and(
            inArray(tickets.seatId, blocking),
            eq(tickets.status, 'valid'),
            eq(showtimes.status, 'scheduled'),
            gt(showtimes.startsAt, now),
          ),
        )
        .limit(1);
      if (sold.length > 0) throw conflict('seat_sold');
      const held = await tx
        .select({ id: seatHolds.id })
        .from(seatHolds)
        .where(and(inArray(seatHolds.seatId, blocking), gt(seatHolds.expiresAt, now)))
        .limit(1);
      if (held.length > 0) throw conflict('seat_held');
    }
    for (const kind of new Set(final.values())) {
      const group = ids.filter((i) => final.get(i) === kind);
      await tx.update(seats).set({ kind }).where(inArray(seats.id, group));
    }
  });

  const upcoming = await db
    .select({ id: showtimes.id })
    .from(showtimes)
    .where(
      and(
        eq(showtimes.hallId, hallId),
        eq(showtimes.status, 'scheduled'),
        gt(showtimes.startsAt, now),
      ),
    );
  for (const show of upcoming) {
    const taken = await nonFreeSeats(db, show.id, now);
    seatHub.publish(
      show.id,
      ids.map((seatId) => ({ seatId, state: taken.get(seatId) ?? ('free' as const) })),
    );
  }
}
