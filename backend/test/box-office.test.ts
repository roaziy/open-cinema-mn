import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import { branches, halls, movies, showtimes } from '../src/db/schema';
import { importFilms } from '../src/services/movie-import';
import {
  ageRatingOf,
  type FetchFn,
  fetchBoxOffice,
  retryAfterMs,
  type TmdbFilm,
} from '../src/services/tmdb';
import { formatForHall, scheduleWeek } from '../src/services/week-schedule';
import { ubDayRange } from '../src/shared';
import { resetDb } from './helpers';

// 2026-11-18 15:00 in Ulaanbaatar (UTC+8).
const NOW = new Date('2026-11-18T07:00:00Z');

const detail = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  title: `Film ${id}`,
  overview: `Тайлбар ${id}`,
  runtime: 120,
  release_date: '2026-11-01',
  poster_path: `/poster${id}.jpg`,
  backdrop_path: `/backdrop${id}.jpg`,
  genres: [
    { id: 28, name: 'Action' },
    { id: 1234, name: 'Odd' },
  ],
  release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] },
  videos: {
    results: [
      { site: 'YouTube', type: 'Teaser', key: 'teaser12345' },
      { site: 'YouTube', type: 'Trailer', key: 'trailer_123', official: true },
    ],
  },
  ...over,
});

/** A fake TMDB: answers by path, records every URL and header it was asked for. */
function fakeTmdb(routes: Record<string, unknown>) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const u = new URL(url);
    calls.push({ url, auth: new Headers(init.headers).get('authorization') });
    const key = `${u.pathname.replace('/3', '')}?${u.searchParams.get('language') ?? ''}`;
    const body = routes[key] ?? routes[u.pathname.replace('/3', '')];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fetchFn, calls };
}

describe('fetchBoxOffice', () => {
  it('maps now playing and upcoming films, with Mongolian text and English fallback', async () => {
    const { fetchFn, calls } = fakeTmdb({
      '/movie/now_playing': { results: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] },
      '/movie/upcoming': {
        results: [
          { id: 2, release_date: '2026-12-01' }, // already showing: not repeated
          { id: 5, release_date: '2026-11-10' }, // already out: not "soon"
          { id: 6, release_date: '2026-12-24' },
        ],
      },
      '/movie/1?mn-MN': detail(1),
      '/movie/2?mn-MN': detail(2, { overview: '' }),
      '/movie/2?en-US': detail(2, { overview: 'English text' }),
      '/movie/3?mn-MN': detail(3, { poster_path: null }),
      '/movie/4?mn-MN': detail(4, { runtime: 0 }),
      '/movie/6?mn-MN': detail(6, {
        release_date: '2026-12-24',
        release_dates: {
          results: [{ iso_3166_1: 'KR', release_dates: [{ certification: '15' }] }],
        },
      }),
    });
    const { films, skipped } = await fetchBoxOffice({
      token: 'tok',
      region: 'KR',
      now: NOW,
      fetchFn,
    });

    expect(films.map((f) => [f.tmdbId, f.status])).toEqual([
      [1, 'now'],
      [2, 'now'],
      [6, 'soon'],
    ]);
    expect(skipped).toEqual(['Film 3 (no poster)', 'Film 4 (no running time)']);
    const [one, two, six] = films as [TmdbFilm, TmdbFilm, TmdbFilm];
    expect(one).toMatchObject({
      synopsis: 'Тайлбар 1',
      durationMin: 120,
      ageRating: '12+',
      genres: ['Тулаант', 'Odd'],
      posterPath: '/poster1.jpg',
      trailerUrl: 'https://www.youtube.com/watch?v=trailer_123',
    });
    expect(two.synopsis).toBe('English text');
    expect(six.ageRating).toBe('15+');
    expect(calls.every((c) => c.url.startsWith('https://api.themoviedb.org/3/'))).toBe(true);
    expect(calls.every((c) => c.auth === 'Bearer tok')).toBe(true);
  });

  it('refuses unsafe image paths and trailer keys', async () => {
    const { fetchFn } = fakeTmdb({
      '/movie/now_playing': { results: [{ id: 7 }] },
      '/movie/upcoming': { results: [] },
      '/movie/7?mn-MN': detail(7, {
        backdrop_path: '/../../etc/passwd',
        videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'x"><script>' }] },
      }),
    });
    const { films } = await fetchBoxOffice({ token: 't', region: 'US', now: NOW, fetchFn });
    expect(films[0]).toMatchObject({ backdropPath: null, trailerUrl: null });
  });
});

describe('TMDB rate limits', () => {
  it('waits what Retry-After asks (capped) and retries a 429', async () => {
    expect(retryAfterMs('3')).toBe(3000);
    expect(retryAfterMs(null)).toBe(2000);
    expect(retryAfterMs('600')).toBe(10_000);
    let lists = 0;
    const waits: number[] = [];
    const fetchFn: FetchFn = async (url) => {
      if (url.includes('/movie/now_playing') && lists++ === 0) {
        return new Response('{}', { status: 429, headers: { 'retry-after': '1' } });
      }
      if (url.includes('now_playing') || url.includes('upcoming')) {
        return Response.json({ results: [] });
      }
      return Response.json({});
    };
    const { films } = await fetchBoxOffice({
      token: 't',
      region: 'US',
      now: NOW,
      fetchFn,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(films).toEqual([]);
    expect(waits).toEqual([1000]);
  });

  it('gives up after three 429s', async () => {
    const fetchFn: FetchFn = async () => new Response('{}', { status: 429 });
    await expect(
      fetchBoxOffice({ token: 't', region: 'US', now: NOW, fetchFn, sleep: async () => {} }),
    ).rejects.toThrow('HTTP 429');
  });
});

describe('ageRatingOf', () => {
  const of = (country: string, certification: string) => ({
    release_dates: { results: [{ iso_3166_1: country, release_dates: [{ certification }] }] },
  });
  it('reads US ratings, numeric ratings and guesses 12+ without one', () => {
    expect(ageRatingOf(of('US', 'R'), 'US')).toBe('16+');
    expect(ageRatingOf(of('US', 'G'), 'MN')).toBe('0+');
    expect(ageRatingOf(of('DE', '16'), 'DE')).toBe('16+');
    expect(ageRatingOf(of('AU', 'MA15+'), 'AU')).toBe('15+');
    expect(ageRatingOf({ release_dates: null }, 'US')).toBe('12+');
  });
});

const film = (tmdbId: number, status: 'now' | 'soon' = 'now'): TmdbFilm => ({
  tmdbId,
  title: `Film ${tmdbId}`,
  synopsis: 'x',
  durationMin: 110,
  ageRating: '12+',
  genres: ['Драм'],
  posterPath: `/p${tmdbId}.jpg`,
  backdropPath: `/b${tmdbId}.jpg`,
  trailerUrl: null,
  releaseDate: '2026-11-01',
  status,
});

describe('importFilms', () => {
  beforeEach(resetDb);

  const png = sharp({ create: { width: 60, height: 90, channels: 3, background: '#1f6f3a' } })
    .png()
    .toBuffer();
  const stored: string[] = [];
  const storage = {
    put: async (key: string) => {
      stored.push(key);
      return `https://media.example.com/${key}`;
    },
  };
  const download = async () => png;

  it('creates, then updates on a re-run instead of duplicating', async () => {
    const first = await importFilms(db, storage, [film(1), film(2)], { now: NOW, download });
    expect(first).toMatchObject({ created: 2, updated: 0, archived: 0, skipped: [] });
    const again = await importFilms(db, storage, [{ ...film(1), title: 'Renamed' }, film(2)], {
      now: NOW,
      download,
    });
    expect(again).toMatchObject({ created: 0, updated: 2 });
    const rows = await db.select().from(movies);
    expect(rows).toHaveLength(2);
    const one = rows.find((r) => r.tmdbId === 1);
    expect(one).toMatchObject({
      title: 'Renamed',
      posterUrl: 'https://media.example.com/posters/tmdb-1.png',
      backdropUrl: 'https://media.example.com/backdrops/tmdb-1.png',
    });
    expect(one?.tone).toMatch(/^#[0-9A-F]{6}$/i);
    expect(stored).toContain('posters/tmdb-2.png');
  });

  it('archives imported films that left, except ones still scheduled; admin films stay', async () => {
    await importFilms(db, storage, [film(1), film(2), film(3)], { now: NOW, download });
    const [admin] = await db
      .insert(movies)
      .values({
        title: 'Admin film',
        durationMin: 90,
        ageRating: '0+',
        posterUrl: 'https://x/p.jpg',
        releaseDate: '2026-11-01',
        status: 'now',
      })
      .returning({ id: movies.id });
    const [b] = await db
      .insert(branches)
      .values({ name: 'B', address: 'UB', lat: 0, lng: 0 })
      .returning({ id: branches.id });
    const [h] = await db
      .insert(halls)
      .values({
        branchId: b?.id as string,
        name: 'H',
        screenWidthM: 10,
        screenHeightM: 4,
        screenXM: 0,
      })
      .returning({ id: halls.id });
    const [kept] = await db.select({ id: movies.id }).from(movies).where(eq(movies.tmdbId, 3));
    await db.insert(showtimes).values({
      movieId: kept?.id as string,
      hallId: h?.id as string,
      startsAt: new Date(NOW.getTime() + 86_400_000),
      priceStandard: 12000,
      pricePremium: 19000,
    });

    const r = await importFilms(db, storage, [film(1)], { now: NOW, download });
    expect(r.archived).toBe(1);
    const status = async (where: ReturnType<typeof eq>) =>
      (await db.select({ s: movies.status }).from(movies).where(where))[0]?.s;
    expect(await status(eq(movies.tmdbId, 2))).toBe('archived');
    expect(await status(eq(movies.tmdbId, 3))).toBe('now'); // still has a future showing
    expect(await status(eq(movies.id, admin?.id as string))).toBe('now');
  });

  it('skips a film whose image is not a picture, and archives nothing on an empty run', async () => {
    await importFilms(db, storage, [film(1)], { now: NOW, download });
    const bad = await importFilms(db, storage, [film(1)], {
      now: NOW,
      download: async () => Buffer.from('<html>'),
    });
    expect(bad.skipped).toHaveLength(1);
    expect(bad.archived).toBe(0);
    expect((await db.select().from(movies))[0]?.status).toBe('now');
  });
});

describe('scheduleWeek', () => {
  beforeEach(resetDb);

  async function setup(hallNames: string[]) {
    const [b] = await db
      .insert(branches)
      .values({ name: 'Central', address: 'UB', lat: 0, lng: 0 })
      .returning({ id: branches.id });
    for (const name of hallNames) {
      await db.insert(halls).values({
        branchId: b?.id as string,
        name,
        screenWidthM: 10,
        screenHeightM: 4,
        screenXM: 0,
      });
    }
    await db.insert(movies).values(
      [100, 130].map((durationMin, i) => ({
        title: `Now ${i}`,
        durationMin,
        ageRating: '12+',
        posterUrl: 'https://x/p.jpg',
        releaseDate: '2026-11-01',
        status: 'now' as const,
      })),
    );
  }

  it('fills the days, skips past starts, formats by hall name, and is safe to re-run', async () => {
    await setup(['IMAX', '3D танхим', 'VIP']);
    const first = await scheduleWeek(db, { now: NOW, days: 2 });
    expect(first.created).toBeGreaterThan(0);
    expect(first.skippedSlots).toBeGreaterThan(0); // today's shows before 15:00

    const rows = await db
      .select({ startsAt: showtimes.startsAt, format: showtimes.format, hall: halls.name })
      .from(showtimes)
      .innerJoin(halls, eq(halls.id, showtimes.hallId));
    expect(rows).toHaveLength(first.created);
    expect(rows.every((r) => r.startsAt > NOW)).toBe(true);
    expect(new Set(rows.filter((r) => r.hall === 'IMAX').map((r) => r.format))).toEqual(
      new Set(['IMAX']),
    );
    expect(new Set(rows.filter((r) => r.hall === 'VIP').map((r) => r.format))).toEqual(
      new Set(['2D']),
    );
    const tomorrow = ubDayRange('2026-11-19');
    expect(rows.some((r) => r.startsAt >= tomorrow.start && r.startsAt < tomorrow.end)).toBe(true);

    const again = await scheduleWeek(db, { now: NOW, days: 2 });
    expect(again).toMatchObject({ created: 0, keptDays: 6 });
  });

  it('asks for movies:update when nothing is showing', async () => {
    await expect(scheduleWeek(db, { now: NOW })).rejects.toThrow(/movies:update/);
  });

  it('names formats from hall names', () => {
    expect(formatForHall('IMAX')).toBe('IMAX');
    expect(formatForHall('3D Dolby Vision')).toBe('3D');
    expect(formatForHall('2D танхим')).toBe('2D');
  });
});
