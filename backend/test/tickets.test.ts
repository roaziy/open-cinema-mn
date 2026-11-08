import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicTicketsSchema } from '@open-cinema/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import {
  bookings,
  branches,
  halls,
  movies,
  seats,
  showtimes,
  tickets,
  users,
} from '../src/db/schema';
import { env } from '../src/env';
import { SeatHub } from '../src/lib/seat-hub';
import { signLink, signPassUrl, verifyLink } from '../src/lib/sign';
import { signAccessToken } from '../src/lib/tokens';
import { MockPaymentProvider } from '../src/payments/mock';
import { createHolds } from '../src/services/holds';
import { fakeMessages, fixedClock, makeTestApp, one, resetDb } from './helpers';

const NOW = '2026-11-08T04:00:00Z';

async function fixture(clock: () => Date) {
  const b = one(
    (
      await db
        .insert(branches)
        .values({ name: 'Central', address: 'a', lat: 47.9, lng: 106.9 })
        .returning()
    )[0],
  );
  const h = one(
    (
      await db
        .insert(halls)
        .values({ branchId: b.id, name: 'H1', screenWidthM: 10, screenHeightM: 5, screenXM: 5 })
        .returning()
    )[0],
  );
  const seatRows = await db
    .insert(seats)
    .values(
      Array.from({ length: 4 }, (_, i) => ({
        hallId: h.id,
        rowLabel: 'A',
        number: i + 1,
        xM: i,
        yM: 1,
      })),
    )
    .returning();
  const m = one(
    (
      await db
        .insert(movies)
        .values({
          title: 'Movie',
          durationMin: 90,
          ageRating: '12+',
          posterUrl: 'p',
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
            movieId: m.id,
            hallId: h.id,
            startsAt: new Date(startsAt),
            priceStandard: 10000,
            pricePremium: 15000,
          })
          .returning()
      )[0],
    );
  const user = async (v: Partial<typeof users.$inferInsert>) => {
    const u = one(
      (
        await db
          .insert(users)
          .values({ role: 'customer', ...v })
          .returning()
      )[0],
    );
    return { id: u.id, auth: `Bearer ${await signAccessToken(u, clock())}` };
  };
  return {
    show,
    seatId: (n: number) => one(seatRows.find((s) => s.number === n)).id,
    alice: await user({ phone: '+97699000001' }),
    bob: await user({ phone: '+97699000002' }),
  };
}

function setup() {
  const clock = fixedClock(NOW);
  const messages = fakeMessages();
  const deps = {
    db,
    clock,
    seatHub: new SeatHub(),
    messages,
    payments: new MockPaymentProvider(db, clock),
  };
  return { clock, messages, app: makeTestApp(deps) };
}

type S = ReturnType<typeof setup>;
type F = Awaited<ReturnType<typeof fixture>>;

/** Holds, books and mock-pays seats; returns the booking id. */
async function buy(
  s: S,
  f: F,
  who: { id: string; auth: string },
  showId: string,
  ...nums: number[]
) {
  const held = await createHolds(db, {
    showtimeId: showId,
    seatIds: nums.map(f.seatId),
    userId: who.id,
    now: s.clock(),
  });
  const created = await request(s.app)
    .post('/v1/bookings')
    .set('Authorization', who.auth)
    .send({ holdIds: held.holds.map((x) => x.id), idempotencyKey: crypto.randomUUID() })
    .expect(200);
  await request(s.app)
    .post(`/v1/bookings/${created.body.id}/mock-pay`)
    .set('Authorization', who.auth)
    .expect(200);
  return created.body.id as string;
}

const ticketsOf = (bookingId: string) =>
  db.select().from(tickets).where(eq(tickets.bookingId, bookingId));

beforeEach(async () => {
  await resetDb();
});

describe('ticket reads', () => {
  it('returns the owner a full TicketView and hides it from everyone else', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const show = await f.show('2026-11-08T11:00:00Z');
    const bookingId = await buy(s, f, f.alice, show.id, 2);
    const [t] = await ticketsOf(bookingId);
    const res = await request(s.app)
      .get(`/v1/tickets/${one(t).id}`)
      .set('Authorization', f.alice.auth)
      .expect(200);
    expect(res.body).toMatchObject({
      id: one(t).id,
      bookingId,
      orderNo: expect.stringMatching(/^OC-\d+$/),
      status: 'valid',
      usedAt: null,
      seat: { rowLabel: 'A', number: 2, kind: 'standard' },
      hallName: 'H1',
      showtime: { id: show.id, startsAt: '2026-11-08T11:00:00.000Z', format: '2D' },
      movie: { title: 'Movie' },
      branch: { name: 'Central' },
      qrToken: one(t).qrToken,
      passUrl: null,
    });
    await request(s.app)
      .get(`/v1/tickets/${one(t).id}`)
      .set('Authorization', f.bob.auth)
      .expect(404);
    await request(s.app)
      .get(`/v1/tickets/${one(t).id}`)
      .expect(401);
    await request(s.app).get('/v1/tickets/nope').set('Authorization', f.alice.auth).expect(404);
  });

  it('splits upcoming (ascending) from past (descending) and keeps cancelled tickets', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    // 04:00Z now; ends = start + 90 min. Buy three days earlier, when every show is still open.
    const DAY = 86_400_000;
    s.clock.advance(-3 * DAY);
    const past1 = await f.show('2026-11-08T01:00:00Z'); // ended 02:30
    const past2 = await f.show('2026-11-07T01:00:00Z');
    const later = await f.show('2026-11-09T11:00:00Z');
    const soon = await f.show('2026-11-08T03:00:00Z'); // ends 04:30, still upcoming
    const ids = [
      await buy(s, f, f.alice, past1.id, 1),
      await buy(s, f, f.alice, past2.id, 1),
      await buy(s, f, f.alice, later.id, 1),
      await buy(s, f, f.alice, soon.id, 1),
      await buy(s, f, f.bob, soon.id, 2),
    ];
    s.clock.advance(3 * DAY);
    // cancel the "later" booking, as an admin cancellation would
    await db
      .update(bookings)
      .set({ status: 'cancelled' })
      .where(eq(bookings.id, ids[2] as string));
    await db
      .update(tickets)
      .set({ status: 'cancelled' })
      .where(eq(tickets.bookingId, ids[2] as string));

    const get = (scope: string) =>
      request(s.app).get(`/v1/me/tickets?scope=${scope}`).set('Authorization', f.alice.auth);
    const up = await get('upcoming').expect(200);
    expect(up.body.map((t: { showtime: { id: string } }) => t.showtime.id)).toEqual([
      soon.id,
      later.id,
    ]);
    expect(up.body[1].status).toBe('cancelled');
    const past = await get('past').expect(200);
    expect(past.body.map((t: { showtime: { id: string } }) => t.showtime.id)).toEqual([
      past1.id,
      past2.id,
    ]);
    await request(s.app)
      .get('/v1/me/tickets?scope=weird')
      .set('Authorization', f.alice.auth)
      .expect(400);
    await request(s.app).get('/v1/me/tickets').expect(401);
  });

  it('shows pending bookings no tickets (none exist yet)', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const show = await f.show('2026-11-08T11:00:00Z');
    const held = await createHolds(db, {
      showtimeId: show.id,
      seatIds: [f.seatId(1)],
      userId: f.alice.id,
      now: s.clock(),
    });
    await request(s.app)
      .post('/v1/bookings')
      .set('Authorization', f.alice.auth)
      .send({ holdIds: held.holds.map((x) => x.id), idempotencyKey: crypto.randomUUID() })
      .expect(200);
    const res = await request(s.app)
      .get('/v1/me/tickets')
      .set('Authorization', f.alice.auth)
      .expect(200);
    expect(res.body).toEqual([]);
  });
});

describe('guest ticket link', () => {
  it('emails a signed /t/ link that works without auth', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const show = await f.show('2026-11-08T11:00:00Z');
    const guest = await (async () => {
      const u = one((await db.insert(users).values({ role: 'guest' }).returning())[0]);
      return { id: u.id, auth: `Bearer ${await signAccessToken(u, s.clock())}` };
    })();
    const held = await createHolds(db, {
      showtimeId: show.id,
      seatIds: [f.seatId(3), f.seatId(4)],
      userId: guest.id,
      now: s.clock(),
    });
    const created = await request(s.app)
      .post('/v1/bookings')
      .set('Authorization', guest.auth)
      .send({
        holdIds: held.holds.map((x) => x.id),
        idempotencyKey: crypto.randomUUID(),
        contactEmail: 'Guest@Mail.mn',
      })
      .expect(200);
    await request(s.app)
      .post(`/v1/bookings/${created.body.id}/mock-pay`)
      .set('Authorization', guest.auth)
      .expect(200);

    const mail = (s.messages as ReturnType<typeof fakeMessages>).sent.find(
      (m) => m.channel === 'email',
    );
    expect(mail?.to).toBe('guest@mail.mn');
    const token = mail?.body.match(/\/t\/([A-Za-z0-9_.-]+)/)?.[1];
    expect(token).toBeTruthy();
    expect(verifyLink(token as string)).toBe(created.body.id);

    const res = await request(s.app).get(`/v1/t/${token}`).expect(200);
    expect(res.body.booking).toMatchObject({
      orderNo: created.body.orderNo,
      status: 'paid',
      total: 20000,
      showtime: { id: show.id },
    });
    expect(res.body.booking.invoice).toBeUndefined();
    expect(res.body.tickets).toHaveLength(2);
    expect(res.body.tickets[0]).toMatchObject({
      status: 'valid',
      qrToken: expect.stringMatching(/^oc1\./),
    });
  });

  it('rejects tampered, foreign and unknown tokens with 404', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const show = await f.show('2026-11-08T11:00:00Z');
    const bookingId = await buy(s, f, f.alice, show.id, 1);
    const token = signLink(bookingId);
    const ok = await request(s.app).get(`/v1/t/${token}`).expect(200);
    expect(PublicTicketsSchema.safeParse(ok.body).success).toBe(true);
    const raw = JSON.stringify(ok.body);
    expect(raw).not.toContain('97699000001');
    expect(raw).not.toMatch(/@|contact|invoice/i);
    await request(s.app).get(`/v1/t/${token}x`).expect(404);
    await request(s.app)
      .get(`/v1/t/${token.replace(bookingId, crypto.randomUUID())}`)
      .expect(404);
    await request(s.app)
      .get(`/v1/t/${signLink(crypto.randomUUID())}`)
      .expect(404);
    await request(s.app).get('/v1/t/garbage').expect(404);
  });
});

describe('wallet pass', () => {
  const wallet = [
    'PASS_TYPE_ID',
    'TEAM_ID',
    'SIGNER_CERT_PATH',
    'SIGNER_KEY_PATH',
    'WWDR_PATH',
  ].map((k) => `WALLET_${k}` as keyof typeof env);
  const saved = Object.fromEntries(wallet.map((k) => [k, env[k]]));
  const dir = mkdtempSync(join(tmpdir(), 'oc-wallet-'));
  const restore = () => Object.assign(env, saved);

  /** Throwaway self-signed certificate; it stands in for both Apple WWDR and the pass cert. */
  const makeCert = () => {
    const cert = join(dir, 'cert.pem');
    const key = join(dir, 'key.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=test',
      ],
      { stdio: 'ignore' },
    );
    return { cert, key };
  };

  afterAll(() => {
    restore();
    rmSync(dir, { recursive: true, force: true });
  });

  async function owned() {
    const s = setup();
    const f = await fixture(s.clock);
    const show = await f.show('2026-11-08T11:00:00Z');
    const bookingId = await buy(s, f, f.alice, show.id, 1);
    const t = one((await ticketsOf(bookingId))[0]);
    return { s, f, t };
  }

  it('answers 503 wallet_not_configured without certificate env', async () => {
    restore();
    Object.assign(env, { WALLET_SIGNER_CERT_PATH: undefined });
    const { s, t } = await owned();
    const res = await request(s.app).get(signPassUrl(t.id, s.clock())).expect(503);
    expect(res.body).toEqual({ error: 'wallet_not_configured' });
  });

  it('rejects expired and tampered signatures with 403', async () => {
    const { s, t } = await owned();
    const url = signPassUrl(t.id, s.clock());
    s.clock.advance(301_000);
    await request(s.app).get(url).expect(403);
    s.clock.advance(-301_000);
    await request(s.app).get(`${url}0`).expect(403);
    await request(s.app).get(url.replace(t.id, crypto.randomUUID())).expect(403);
  });

  it('serves a signed .pkpass when configured and exposes passUrl', async () => {
    const { cert, key } = makeCert();
    Object.assign(env, {
      WALLET_PASS_TYPE_ID: 'pass.test.opencinema',
      WALLET_TEAM_ID: 'TEAM123456',
      WALLET_SIGNER_CERT_PATH: cert,
      WALLET_SIGNER_KEY_PATH: key,
      WALLET_WWDR_PATH: cert,
      WALLET_ORG_NAME: 'Other Op',
    });
    try {
      const { s, f, t } = await owned();
      const view = await request(s.app)
        .get(`/v1/tickets/${t.id}`)
        .set('Authorization', f.alice.auth)
        .expect(200);
      expect(view.body.passUrl).toMatch(
        new RegExp(`^${env.API_PUBLIC_URL}/v1/tickets/${t.id}/pass\\?exp=\\d+&sig=`),
      );
      const res = await request(s.app)
        .get(view.body.passUrl.slice(env.API_PUBLIC_URL.length))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain('application/vnd.apple.pkpass');
      const body = res.body as Buffer;
      expect(body.subarray(0, 2).toString()).toBe('PK');
      // pkpass entries are stored uncompressed, so the pass JSON is readable in the archive
      const text = body.toString('utf8');
      expect(text).toContain('pass.json');
      expect(text).toContain('"PKBarcodeFormatQR"');
      expect(text).toContain(t.qrToken);
      expect(text).toContain('pass.test.opencinema');
      expect(text).toContain('manifest.json');
      expect(text).toContain('signature');
      const from = text.indexOf('{"formatVersion"');
      const passJson = JSON.parse(text.slice(from, text.indexOf('PK\x03\x04', from)));
      expect(passJson).toMatchObject({
        logoText: 'Other Op',
        organizationName: 'Other Op',
        description: 'Movie — тасалбар',
        relevantDate: '2026-11-08T11:00:00.000Z',
        locations: [{ latitude: 47.9, longitude: 106.9 }],
        relevantDates: [
          { startDate: '2026-11-08T11:00:00.000Z', endDate: '2026-11-08T12:30:00.000Z' },
        ],
      });
    } finally {
      restore();
    }
  });

  it('mints a fresh pass url for a link holder, only for tickets of that booking', async () => {
    const { cert, key } = makeCert();
    Object.assign(env, {
      WALLET_PASS_TYPE_ID: 'pass.test.opencinema',
      WALLET_TEAM_ID: 'TEAM123456',
      WALLET_SIGNER_CERT_PATH: cert,
      WALLET_SIGNER_KEY_PATH: key,
      WALLET_WWDR_PATH: cert,
    });
    try {
      const { s, f, t } = await owned();
      const link = signLink(t.bookingId);
      const res = await request(s.app).get(`/v1/t/${link}/pass/${t.id}`).expect(200);
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.body.url).toMatch(
        new RegExp(`^${env.API_PUBLIC_URL}/v1/tickets/${t.id}/pass\\?exp=\\d+&sig=`),
      );
      // the url is short-lived and minted per tap
      s.clock.advance(200_000);
      const later = await request(s.app).get(`/v1/t/${link}/pass/${t.id}`).expect(200);
      expect(later.body.url).not.toBe(res.body.url);
      s.clock.advance(150_000);
      await request(s.app).get(res.body.url.slice(env.API_PUBLIC_URL.length)).expect(403);
      await request(s.app).get(later.body.url.slice(env.API_PUBLIC_URL.length)).expect(200);

      // another booking's ticket, a bad link and a cancelled ticket are all 404
      const showB = await f.show('2026-11-08T13:00:00Z');
      const otherBooking = await buy(s, f, f.alice, showB.id, 2);
      await request(s.app)
        .get(`/v1/t/${signLink(otherBooking)}/pass/${t.id}`)
        .expect(404);
      await request(s.app).get(`/v1/t/${link}x/pass/${t.id}`).expect(404);
      await request(s.app).get(`/v1/t/${link}/pass/not-a-uuid`).expect(404);
      await db.update(tickets).set({ status: 'cancelled' }).where(eq(tickets.id, t.id));
      await request(s.app).get(`/v1/t/${link}/pass/${t.id}`).expect(404);
    } finally {
      restore();
    }
  });

  it('answers 503 for the link pass url while wallet is not configured', async () => {
    restore();
    Object.assign(env, { WALLET_SIGNER_CERT_PATH: undefined });
    const { s, t } = await owned();
    const res = await request(s.app)
      .get(`/v1/t/${signLink(t.bookingId)}/pass/${t.id}`)
      .expect(503);
    expect(res.body).toEqual({ error: 'wallet_not_configured' });
  });

  it('gives a cancelled ticket no passUrl and no pass', async () => {
    const { cert, key } = makeCert();
    Object.assign(env, {
      WALLET_PASS_TYPE_ID: 'pass.test.opencinema',
      WALLET_TEAM_ID: 'TEAM123456',
      WALLET_SIGNER_CERT_PATH: cert,
      WALLET_SIGNER_KEY_PATH: key,
      WALLET_WWDR_PATH: cert,
    });
    try {
      const { s, f, t } = await owned();
      await db.update(tickets).set({ status: 'cancelled' }).where(eq(tickets.id, t.id));
      const view = await request(s.app)
        .get(`/v1/tickets/${t.id}`)
        .set('Authorization', f.alice.auth)
        .expect(200);
      expect(view.body).toMatchObject({ status: 'cancelled', passUrl: null });
      await request(s.app).get(signPassUrl(t.id, s.clock())).expect(404);
    } finally {
      restore();
    }
  });

  it('answers 503 when a certificate file cannot be read', async () => {
    Object.assign(env, {
      WALLET_PASS_TYPE_ID: 'pass.test.opencinema',
      WALLET_TEAM_ID: 'TEAM123456',
      WALLET_SIGNER_CERT_PATH: join(dir, 'missing.pem'),
      WALLET_SIGNER_KEY_PATH: join(dir, 'missing.key'),
      WALLET_WWDR_PATH: join(dir, 'missing.pem'),
    });
    try {
      const { s, t } = await owned();
      const res = await request(s.app).get(signPassUrl(t.id, s.clock())).expect(503);
      expect(res.body).toEqual({ error: 'wallet_not_configured' });
    } finally {
      restore();
    }
  });
});
