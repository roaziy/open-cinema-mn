import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { isUniqueViolation } from '../src/lib/errors';
import { resetDb } from './helpers';

async function fixture() {
  const [branch] = await db
    .insert(s.branches)
    .values({ name: 'B', address: 'A', lat: 1, lng: 2 })
    .returning();
  const [hall] = await db
    .insert(s.halls)
    .values({ branchId: branch.id, name: 'H1', screenWidthM: 10, screenHeightM: 4, screenXM: 5 })
    .returning();
  const [seat] = await db
    .insert(s.seats)
    .values({ hallId: hall.id, rowLabel: 'A', number: 1, xM: 1, yM: 3 })
    .returning();
  const [movie] = await db
    .insert(s.movies)
    .values({
      title: 'M',
      durationMin: 90,
      ageRating: 'PG',
      posterUrl: 'p',
      releaseDate: '2026-01-01',
    })
    .returning();
  const [showtime] = await db
    .insert(s.showtimes)
    .values({
      movieId: movie.id,
      hallId: hall.id,
      startsAt: new Date(),
      priceStandard: 15000,
      pricePremium: 20000,
    })
    .returning();
  const [user] = await db.insert(s.users).values({ role: 'customer' }).returning();
  const [booking] = await db
    .insert(s.bookings)
    .values({
      userId: user.id,
      showtimeId: showtime.id,
      total: 15000,
      idempotencyKey: crypto.randomUUID(),
    })
    .returning();
  return { seat, showtime, booking, user, hall };
}

describe('schema constraints', () => {
  beforeEach(resetDb);

  it('allows only one valid ticket per seat, but a cancelled one does not block', async () => {
    const f = await fixture();
    const base = {
      bookingId: f.booking.id,
      showtimeId: f.showtime.id,
      seatId: f.seat.id,
      qrToken: 't',
    };
    await db.insert(s.tickets).values({ ...base, status: 'cancelled' });
    await db.insert(s.tickets).values(base);
    const dup = await db
      .insert(s.tickets)
      .values(base)
      .catch((e) => e);
    expect(isUniqueViolation(dup)).toBe(true);
  });

  it('keeps one hold per showtime seat and unique seat coordinates per hall', async () => {
    const f = await fixture();
    const hold = {
      showtimeId: f.showtime.id,
      seatId: f.seat.id,
      userId: f.user.id,
      expiresAt: new Date(),
    };
    await db.insert(s.seatHolds).values(hold);
    expect(
      isUniqueViolation(
        await db
          .insert(s.seatHolds)
          .values(hold)
          .catch((e) => e),
      ),
    ).toBe(true);
    const dupSeat = await db
      .insert(s.seats)
      .values({ hallId: f.hall.id, rowLabel: 'A', number: 1, xM: 0, yM: 0 })
      .catch((e) => e);
    expect(isUniqueViolation(dupSeat)).toBe(true);
  });

  it('allows many users without phone/email but not duplicates', async () => {
    await db.insert(s.users).values([{ role: 'guest' }, { role: 'guest' }]);
    await db.insert(s.users).values({ phone: '99112045' });
    const dup = await db
      .insert(s.users)
      .values({ phone: '99112045' })
      .catch((e) => e);
    expect(isUniqueViolation(dup)).toBe(true);
  });
});
