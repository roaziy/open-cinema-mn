import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verify } from '@node-rs/argon2';
import { formatUbTime, ubDate } from '@open-cinema/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import { runSeed } from '../src/db/run-seed';
import { halls, movies, seats, showtimes, users } from '../src/db/schema';
import { LocalStorage } from '../src/storage/local';
import { fixedClock, makeTestApp, resetDb } from './helpers';

const NOW = '2026-11-08T04:00:00Z'; // 12:00 in Ulaanbaatar
let dir: string;
let storage: LocalStorage;

const seed = (over: Partial<Parameters<typeof runSeed>[0]> = {}) =>
  runSeed({
    db,
    storage,
    now: fixedClock(NOW)(),
    nodeEnv: 'test',
    adminEmail: 'Admin@Example.com',
    adminPassword: 'seed-admin-pass',
    ...over,
  });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'oc-media-'));
  storage = new LocalStorage('http://localhost:4000', dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));
beforeEach(resetDb);

describe('seed', () => {
  it('creates 4 now-showing films with poster URLs and 2 coming soon', async () => {
    const summary = await seed();
    expect(summary).toMatchObject({ branches: 3, halls: 9, films: 6 });

    const api = await request(makeTestApp({ clock: fixedClock(NOW) })).get('/v1/movies?status=now');
    expect(api.status).toBe(200);
    expect(api.body.length).toBeGreaterThanOrEqual(4);
    for (const m of api.body)
      expect(m.posterUrl).toMatch(/^http:\/\/localhost:4000\/media\/posters\/.+\.png$/);

    const rows = await db.select().from(movies);
    for (const m of rows) {
      expect(m.posterUrl).toMatch(/^http:\/\/localhost:4000\/media\/posters\/.+\.png$/);
      expect(m.backdropUrl).toBe(m.posterUrl);
      expect(m.synopsis.split(/[.!?]\s/).length).toBe(2);
    }
    const soon = rows
      .filter((m) => m.status === 'soon')
      .sort((a, b) => a.title.localeCompare(b.title));
    expect(soon.map((m) => [m.title, m.releaseDate])).toEqual([
      ['Дохио', '2026-12-04'],
      ['Улаан морь', '2026-11-20'],
    ]);
  });

  it('is idempotent', async () => {
    const first = await seed();
    const second = await seed();
    expect(second).toEqual(first);
    expect(await db.select().from(movies)).toHaveLength(6);
    expect(await db.select().from(users)).toHaveLength(3);
  });

  it('refuses to run in production and leaves data alone', async () => {
    await seed();
    await expect(seed({ nodeEnv: 'production' })).rejects.toThrow(/production/);
    expect(await db.select().from(movies)).toHaveLength(6);
  });

  it('creates an admin with a verifiable password and two staff on the central branch', async () => {
    await seed();
    const [admin] = await db.select().from(users).where(eq(users.role, 'admin'));
    expect(admin?.email).toBe('admin@example.com');
    expect(await verify(admin?.passwordHash as string, 'seed-admin-pass')).toBe(true);
    const staff = await db.select().from(users).where(eq(users.role, 'staff'));
    expect(staff.map((s) => s.phone).sort()).toEqual(['+97688000001', '+97688000002']);
    expect(new Set(staff.map((s) => s.branchId)).size).toBe(1);
  });

  it('marks row J premium and A1/A12 wheelchair in every hall', async () => {
    await seed();
    const allHalls = await db.select().from(halls);
    for (const h of allHalls) {
      const hs = await db.select().from(seats).where(eq(seats.hallId, h.id));
      const kind = (row: string, n: number) =>
        hs.find((s) => s.rowLabel === row && s.number === n)?.kind;
      expect(kind('A', 1)).toBe('wheelchair');
      expect(kind('A', 12)).toBe('wheelchair');
      expect(hs.filter((s) => s.rowLabel === 'J').every((s) => s.kind === 'premium')).toBe(true);
      expect(hs.filter((s) => s.rowLabel === 'J').length).toBeGreaterThan(0);
    }
  });

  it('schedules 7 UB days of realistic, non-overlapping shows', async () => {
    await seed();
    const shows = await db.select().from(showtimes);
    const films = new Map((await db.select().from(movies)).map((m) => [m.id, m]));
    expect(new Set(shows.map((s) => ubDate(s.startsAt)))).toEqual(
      new Set([
        '2026-11-08',
        '2026-11-09',
        '2026-11-10',
        '2026-11-11',
        '2026-11-12',
        '2026-11-13',
        '2026-11-14',
      ]),
    );
    const byHall = new Map<string, typeof shows>();
    for (const s of shows) byHall.set(s.hallId, [...(byHall.get(s.hallId) ?? []), s]);
    for (const list of byHall.values()) {
      list.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      list.forEach((s, i) => {
        const movie = films.get(s.movieId);
        expect(movie?.status).toBe('now');
        expect(formatUbTime(s.startsAt) >= '10:00' && formatUbTime(s.startsAt) <= '23:30').toBe(
          true,
        );
        expect(s.priceStandard).toBeGreaterThanOrEqual(12000);
        expect(s.priceStandard).toBeLessThanOrEqual(18000);
        expect(s.pricePremium).toBe(s.priceStandard + 7000);
        const next = list[i + 1];
        if (next) {
          const end = s.startsAt.getTime() + (movie?.durationMin as number) * 60_000;
          expect(next.startsAt.getTime() - end).toBeGreaterThanOrEqual(15 * 60_000);
        }
      });
    }
  });

  it('writes posters through the storage provider', async () => {
    await seed();
    const [m] = await db.select().from(movies).where(eq(movies.title, 'Талын салхи'));
    expect(m?.posterUrl).toBe('http://localhost:4000/media/posters/talyn-salkhi.png');
    const bytes = await readFile(path.join(dir, 'posters/talyn-salkhi.png'));
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  });
});
