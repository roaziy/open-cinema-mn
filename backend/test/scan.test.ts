import { ScanResultSchema } from '@open-cinema/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import {
  branches,
  halls,
  movies,
  seats,
  showtimes,
  ticketScans,
  tickets,
  users,
} from '../src/db/schema';
import { SeatHub } from '../src/lib/seat-hub';
import { signAccessToken } from '../src/lib/tokens';
import { MockPaymentProvider } from '../src/payments/mock';
import { createHolds } from '../src/services/holds';
import { fakeMessages, fixedClock, makeTestApp, one, resetDb } from './helpers';

// 2026-11-08 10:00 UTC is 18:00 in Ulaanbaatar.
const NOW = '2026-11-08T10:00:00Z';
const MIN = 60_000;
const DEV_A = '11111111-1111-4111-8111-111111111111';
const DEV_B = '22222222-2222-4222-8222-222222222222';
const uuid = () => crypto.randomUUID();

async function fixture() {
  const [b1, b2] = await db
    .insert(branches)
    .values([
      { name: 'Central', address: 'a', lat: 47.9, lng: 106.9 },
      { name: 'North', address: 'b', lat: 47.9, lng: 106.9 },
    ])
    .returning();
  const mkHall = async (branchId: string, name: string) =>
    one(
      (
        await db
          .insert(halls)
          .values({ branchId, name, screenWidthM: 10, screenHeightM: 5, screenXM: 5 })
          .returning()
      )[0],
    );
  const hall = await mkHall(one(b1).id, 'Hall 1');
  const seatRows = await db
    .insert(seats)
    .values(
      Array.from({ length: 6 }, (_, i) => ({
        hallId: hall.id,
        rowLabel: 'F',
        number: i + 1,
        xM: i,
        yM: 1,
      })),
    )
    .returning();
  const movie = one(
    (
      await db
        .insert(movies)
        .values({
          title: 'Movie',
          durationMin: 90,
          ageRating: '12+',
          posterUrl: 'p.jpg',
          tone: '#112233',
          status: 'now',
          releaseDate: '2026-11-01',
        })
        .returning()
    )[0],
  );
  const show = async (startsAt: string) =>
    one(
      (
        await db
          .insert(showtimes)
          .values({
            movieId: movie.id,
            hallId: hall.id,
            startsAt: new Date(startsAt),
            priceStandard: 10000,
            pricePremium: 15000,
          })
          .returning()
      )[0],
    );
  const user = async (v: Partial<typeof users.$inferInsert>) =>
    one((await db.insert(users).values(v).returning())[0]);
  return {
    show,
    seatId: (n: number) => one(seatRows.find((s) => s.number === n)).id,
    alice: await user({ role: 'customer', phone: '+97699000001' }),
    staffA: await user({
      role: 'staff',
      name: 'Staff A',
      phone: '+97688000001',
      branchId: one(b1).id,
    }),
    staffB: await user({
      role: 'staff',
      name: 'Staff B',
      phone: '+97688000002',
      branchId: one(b1).id,
    }),
    staffC: await user({
      role: 'staff',
      name: 'Staff C',
      phone: '+97688000003',
      branchId: one(b2).id,
    }),
    admin: await user({ role: 'admin', name: 'Admin', email: 'a@x.mn' }),
  };
}

function setup() {
  const clock = fixedClock(NOW);
  const deps = {
    db,
    clock,
    seatHub: new SeatHub(),
    messages: fakeMessages(),
    payments: new MockPaymentProvider(db, clock),
  };
  return { clock, app: makeTestApp(deps) };
}
type S = ReturnType<typeof setup>;
type F = Awaited<ReturnType<typeof fixture>>;

/** Tokens are signed when asked for, because the clock moves during a test. */
const bearer = async (s: S, u: { id: string; role: 'staff' | 'admin' | 'customer' | 'guest' }) =>
  `Bearer ${await signAccessToken(u, s.clock())}`;

/** Holds, books and mock-pays seats; returns the booking's tickets in seat order. */
async function buy(s: S, f: F, showId: string, ...nums: number[]) {
  const held = await createHolds(db, {
    showtimeId: showId,
    seatIds: nums.map(f.seatId),
    userId: f.alice.id,
    now: s.clock(),
  });
  const auth = await bearer(s, f.alice);
  const created = await request(s.app)
    .post('/v1/bookings')
    .set('Authorization', auth)
    .send({ holdIds: held.holds.map((x) => x.id), idempotencyKey: uuid() })
    .expect(200);
  await request(s.app)
    .post(`/v1/bookings/${created.body.id}/mock-pay`)
    .set('Authorization', auth)
    .expect(200);
  return db.select().from(tickets).where(eq(tickets.bookingId, created.body.id));
}

async function scan(
  s: S,
  who: { id: string; role: 'staff' | 'admin' | 'customer' | 'guest' },
  token: string,
  opts: { scanId?: string; deviceId?: string; status?: number } = {},
) {
  return request(s.app)
    .post('/v1/staff/scan')
    .set('Authorization', await bearer(s, who))
    .send({ token, scanId: opts.scanId ?? uuid(), deviceId: opts.deviceId ?? DEV_A })
    .expect(opts.status ?? 200);
}

const scanRows = () => db.select().from(ticketScans);

beforeEach(async () => {
  await resetDb();
});

describe('scan', () => {
  it('admits once and returns the full card', async () => {
    const s = setup();
    const f = await fixture();
    const show = await f.show('2026-11-08T11:00:00Z');
    const ts = await buy(s, f, show.id, 3, 1, 2);
    const second = one(ts.find((t) => t.seatId === f.seatId(2)));
    const res = await scan(s, f.staffA, second.qrToken);
    expect(ScanResultSchema.parse(res.body)).toMatchObject({
      result: 'admitted',
      ticket: {
        id: second.id,
        seatCode: 'F2',
        hallName: 'Hall 1',
        movieTitle: 'Movie',
        posterUrl: 'p.jpg',
        tone: '#112233',
        startsAt: '2026-11-08T11:00:00.000Z',
        partyIndex: 2,
        partySize: 3,
      },
      previous: null,
      undoUntil: '2026-11-08T10:02:00.000Z',
    });
    const [after] = await db.select().from(tickets).where(eq(tickets.id, second.id));
    expect(after?.usedBy).toBe(f.staffA.id);
    expect(after?.usedAt?.toISOString()).toBe(NOW.replace('Z', '.000Z'));
  });

  it('returns the stored result for a repeated scanId, even after the ticket changed', async () => {
    const s = setup();
    const f = await fixture();
    const show = await f.show('2026-11-08T11:00:00Z');
    const [t] = await buy(s, f, show.id, 1);
    const scanId = uuid();
    const first = await scan(s, f.staffA, one(t).qrToken, { scanId });
    s.clock.advance(10 * MIN);
    const again = await scan(s, f.staffA, one(t).qrToken, { scanId });
    expect(again.body).toEqual(first.body);
    expect(again.body.result).toBe('admitted');
    expect(await scanRows()).toHaveLength(1);
  });

  it('rejects a scanId used by another staff member', async () => {
    const s = setup();
    const f = await fixture();
    const show = await f.show('2026-11-08T11:00:00Z');
    const [t] = await buy(s, f, show.id, 1);
    const scanId = uuid();
    await scan(s, f.staffA, one(t).qrToken, { scanId });
    const res = await scan(s, f.staffB, one(t).qrToken, { scanId, status: 409 });
    expect(res.body.error).toBe('scan_id_conflict');
  });

  it('same door within 2 minutes is a repeat, another door or later is already_used', async () => {
    const s = setup();
    const f = await fixture();
    const show = await f.show('2026-11-08T11:00:00Z');
    const [t] = await buy(s, f, show.id, 1);
    const token = one(t).qrToken;
    await scan(s, f.staffA, token, { deviceId: DEV_A });

    s.clock.advance(30_000);
    const repeat = await scan(s, f.staffA, token, { deviceId: DEV_A });
    expect(repeat.body).toMatchObject({
      result: 'repeat',
      previous: { at: '2026-11-08T10:00:00.000Z', staffName: 'Staff A', deviceLabel: null },
      undoUntil: null,
    });
    // The same door counts even when another staff member holds the phone.
    const sameDoorOtherStaff = await scan(s, f.staffB, token, { deviceId: DEV_A });
    expect(sameDoorOtherStaff.body.result).toBe('repeat');

    const other = await scan(s, f.staffB, token, { deviceId: DEV_B });
    expect(other.body).toMatchObject({
      result: 'already_used',
      previous: { at: '2026-11-08T10:00:00.000Z', staffName: 'Staff A' },
    });

    s.clock.advance(2 * MIN + 1000);
    const late = await scan(s, f.staffA, token, { deviceId: DEV_A });
    expect(late.body.result).toBe('already_used');
    // Replays and rejects never change who admitted the ticket.
    const [after] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, one(t).id));
    expect(after?.usedBy).toBe(f.staffA.id);
  });

  it('undo clears the admit and a rescan admits again', async () => {
    const s = setup();
    const f = await fixture();
    const show = await f.show('2026-11-08T11:00:00Z');
    const [t] = await buy(s, f, show.id, 1);
    const token = one(t).qrToken;
    const first = await scan(s, f.staffA, token);
    const authA = await bearer(s, f.staffA);

    // Another staff member cannot undo it; nor can anyone undo an unknown or non-admit scan.
    await request(s.app)
      .post(`/v1/staff/scan/${first.body.scanId}/undo`)
      .set('Authorization', await bearer(s, f.staffB))
      .expect(403)
      .expect((r) => expect(r.body.error).toBe('undo_forbidden'));
    await request(s.app)
      .post(`/v1/staff/scan/${uuid()}/undo`)
      .set('Authorization', authA)
      .expect(403);

    s.clock.advance(MIN);
    const undone = await request(s.app)
      .post(`/v1/staff/scan/${first.body.scanId}/undo`)
      .set('Authorization', await bearer(s, f.staffA))
      .expect(200);
    expect(undone.body).toMatchObject({
      result: 'undone',
      ticket: { id: one(t).id },
      previous: null,
      undoUntil: null,
    });
    const [cleared] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, one(t).id));
    expect(cleared?.usedAt).toBeNull();
    expect(cleared?.usedBy).toBeNull();

    // Undoing twice answers the same.
    const twice = await request(s.app)
      .post(`/v1/staff/scan/${first.body.scanId}/undo`)
      .set('Authorization', await bearer(s, f.staffA))
      .expect(200);
    expect(twice.body).toEqual(undone.body);

    const rescan = await scan(s, f.staffA, token);
    expect(rescan.body.result).toBe('admitted');
    const rows = await scanRows();
    expect(rows.filter((r) => r.result === 'undone')).toHaveLength(1);
    expect(one(rows.find((r) => r.result === 'undone')).previousScanId).toBe(
      one(rows.find((r) => r.scanId === first.body.scanId)).id,
    );
  });

  it('refuses undo after the window', async () => {
    const s = setup();
    const f = await fixture();
    const show = await f.show('2026-11-08T11:00:00Z');
    const [t] = await buy(s, f, show.id, 1);
    const first = await scan(s, f.staffA, one(t).qrToken);
    s.clock.advance(2 * MIN + 1000);
    await request(s.app)
      .post(`/v1/staff/scan/${first.body.scanId}/undo`)
      .set('Authorization', await bearer(s, f.staffA))
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('undo_expired'));
    const [still] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, one(t).id));
    expect(still?.usedAt).not.toBeNull();
  });

  it('refuses undo when used_at no longer belongs to that admit', async () => {
    const s = setup();
    const f = await fixture();
    const show = await f.show('2026-11-08T11:00:00Z');
    const [t] = await buy(s, f, show.id, 2);
    const a = await scan(s, f.staffA, one(t).qrToken);
    await db
      .update(tickets)
      .set({ usedAt: new Date('2026-11-08T09:00:00Z') })
      .where(eq(tickets.id, one(t).id));
    await request(s.app)
      .post(`/v1/staff/scan/${a.body.scanId}/undo`)
      .set('Authorization', await bearer(s, f.staffA))
      .expect(409);
  });

  it('rejects the wrong branch but lets an admin scan any branch', async () => {
    const s = setup();
    const f = await fixture();
    const show = await f.show('2026-11-08T11:00:00Z');
    const [t] = await buy(s, f, show.id, 1);
    const wrong = await scan(s, f.staffC, one(t).qrToken);
    expect(wrong.body).toMatchObject({ result: 'wrong_branch', ticket: { id: one(t).id } });
    const [unused] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, one(t).id));
    expect(unused?.usedAt).toBeNull();
    const admin = await scan(s, f.admin, one(t).qrToken);
    expect(admin.body.result).toBe('admitted');
  });

  it('judges the day in Ulaanbaatar, across UB midnight', async () => {
    const s = setup();
    const f = await fixture();
    // Sold at 18:00 UB on the 8th for a 23:30 UB show (15:30Z) and a 00:45 UB show on the 9th (16:45Z).
    const late = await f.show('2026-11-08T15:30:00Z');
    const after = await f.show('2026-11-08T16:45:00Z');
    const [tLate] = await buy(s, f, late.id, 1);
    const [tAfter] = await buy(s, f, after.id, 2);

    // 00:30 UB on the 9th, still the 8th in UTC.
    s.clock.advance(6.5 * 60 * MIN);
    expect(s.clock().toISOString()).toBe('2026-11-08T16:30:00.000Z');
    const wrongDay = await scan(s, f.staffA, one(tLate).qrToken);
    expect(wrongDay.body.result).toBe('wrong_day');
    const ok = await scan(s, f.staffA, one(tAfter).qrToken);
    expect(ok.body.result).toBe('admitted');
    const [untouched] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, one(tLate).id));
    expect(untouched?.usedAt).toBeNull();
  });

  it('answers invalid for forged tokens, unknown tickets and cancelled tickets', async () => {
    const s = setup();
    const f = await fixture();
    const show = await f.show('2026-11-08T11:00:00Z');
    const [t] = await buy(s, f, show.id, 1);
    for (const token of ['garbage', `${one(t).qrToken}x`, 'oc1.not-a-uuid.also-not.sig']) {
      const res = await scan(s, f.staffA, token);
      expect(res.body).toMatchObject({ result: 'invalid', ticket: null, previous: null });
    }
    await db
      .update(tickets)
      .set({ status: 'cancelled' })
      .where(eq(tickets.id, one(t).id));
    const cancelled = await scan(s, f.staffA, one(t).qrToken);
    expect(cancelled.body).toMatchObject({ result: 'invalid', ticket: null });
    expect((await scanRows()).every((r) => r.result === 'invalid')).toBe(true);
  });

  it('is staff-only and validates the body', async () => {
    const s = setup();
    const f = await fixture();
    const body = { token: 'x', scanId: uuid(), deviceId: DEV_A };
    await request(s.app).post('/v1/staff/scan').send(body).expect(401);
    await request(s.app)
      .post('/v1/staff/scan')
      .set('Authorization', await bearer(s, f.alice))
      .send(body)
      .expect(403);
    await request(s.app)
      .post('/v1/staff/scan')
      .set('Authorization', await bearer(s, f.staffA))
      .send({ token: 'x', scanId: 'nope', deviceId: DEV_A })
      .expect(400);
  });
});

describe('concurrency', () => {
  it('two devices scanning one ticket at once admit exactly once', async () => {
    const s = setup();
    const f = await fixture();
    const show = await f.show('2026-11-08T11:00:00Z');
    const [t] = await buy(s, f, show.id, 1);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        scan(s, i % 2 ? f.staffA : f.staffB, one(t).qrToken, {
          deviceId: i % 2 ? DEV_A : DEV_B,
        }),
      ),
    );
    const codes = results.map((r) => r.body.result as string);
    expect(codes.filter((c) => c === 'admitted')).toHaveLength(1);
    expect(codes.every((c) => ['admitted', 'repeat', 'already_used'].includes(c))).toBe(true);
    expect((await scanRows()).filter((r) => r.result === 'admitted')).toHaveLength(1);
  });

  it('the same scanId in parallel gives identical bodies and one row', async () => {
    const s = setup();
    const f = await fixture();
    const show = await f.show('2026-11-08T11:00:00Z');
    const [t] = await buy(s, f, show.id, 1);
    const scanId = uuid();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => scan(s, f.staffA, one(t).qrToken, { scanId })),
    );
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.body).toEqual(one(results[0]).body);
    }
    expect(one(results[0]).body.result).toBe('admitted');
    expect(await scanRows()).toHaveLength(1);
  });
});

describe('recent and today', () => {
  it('lists this staff member’s last 10 scans on a device, newest first', async () => {
    const s = setup();
    const f = await fixture();
    const show = await f.show('2026-11-08T11:00:00Z');
    const ts = await buy(s, f, show.id, 1, 2, 3, 4, 5, 6);
    const ids: string[] = [];
    for (const t of ts) {
      s.clock.advance(1000);
      ids.push((await scan(s, f.staffA, t.qrToken)).body.scanId);
    }
    s.clock.advance(1000);
    const other = await scan(s, f.staffA, one(ts[0]).qrToken, { deviceId: DEV_B });
    s.clock.advance(1000);
    await scan(s, f.staffB, one(ts[0]).qrToken); // someone else's scan, same device
    s.clock.advance(1000);
    await request(s.app)
      .post(`/v1/staff/scan/${ids[5]}/undo`)
      .set('Authorization', await bearer(s, f.staffA))
      .expect(200);
    for (let i = 0; i < 6; i++) {
      s.clock.advance(1000);
      await scan(s, f.staffA, one(ts[0]).qrToken, { deviceId: DEV_A }); // repeats pad the list past 10
    }

    const res = await request(s.app)
      .get(`/v1/staff/scans/recent?deviceId=${DEV_A}`)
      .set('Authorization', await bearer(s, f.staffA))
      .expect(200);
    expect(res.body).toHaveLength(10);
    for (const r of res.body) ScanResultSchema.parse(r);
    expect(res.body.slice(0, 6).every((r: { result: string }) => r.result === 'repeat')).toBe(true);
    expect(res.body[6].result).toBe('undone');
    expect(res.body.map((r: { scanId: string }) => r.scanId)).not.toContain(other.body.scanId);
    // The undone admit no longer offers Undo.
    const undoneAdmit = res.body.find((r: { scanId: string }) => r.scanId === ids[5]);
    expect(undoneAdmit.undoUntil).toBeNull();
    await request(s.app)
      .get('/v1/staff/scans/recent')
      .set('Authorization', await bearer(s, f.staffA))
      .expect(400);
  });

  it('shows today’s showtimes for the staff branch with door progress', async () => {
    const s = setup();
    const f = await fixture();
    const evening = await f.show('2026-11-08T11:00:00Z');
    const morning = await f.show('2026-11-08T02:00:00Z'); // 10:00 UB
    await f.show('2026-11-09T02:00:00Z'); // tomorrow in UB
    await f.show('2026-11-07T15:00:00Z'); // 23:00 UB yesterday
    const tickets3 = await buy(s, f, evening.id, 1, 2, 3);
    await scan(s, f.staffA, one(tickets3[0]).qrToken);
    await scan(s, f.staffA, one(tickets3[1]).qrToken);

    const res = await request(s.app)
      .get('/v1/staff/today')
      .set('Authorization', await bearer(s, f.staffA))
      .expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: morning.id, admitted: 0, sold: 0, capacity: 6 }),
      {
        id: evening.id,
        startsAt: '2026-11-08T11:00:00.000Z',
        hallName: 'Hall 1',
        movieTitle: 'Movie',
        posterUrl: 'p.jpg',
        tone: '#112233',
        admitted: 2,
        sold: 3,
        capacity: 6,
      },
    ]);
    const otherBranch = await request(s.app)
      .get('/v1/staff/today')
      .set('Authorization', await bearer(s, f.staffC))
      .expect(200);
    expect(otherBranch.body).toEqual([]);
    const admin = await request(s.app)
      .get(`/v1/staff/today?branchId=${f.staffC.branchId}`)
      .set('Authorization', await bearer(s, f.admin))
      .expect(200);
    expect(admin.body).toEqual([]);
    const adminAll = await request(s.app)
      .get('/v1/staff/today')
      .set('Authorization', await bearer(s, f.admin))
      .expect(200);
    expect(adminAll.body).toHaveLength(2);
  });
});
