// Reads current cinema releases from TMDB (themoviedb.org). Every response is validated before
// use, and only TMDB's own image host is ever fetched.
import { z } from 'zod';
import { addDays, ubDate } from '../shared';

const API = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE = 'https://image.tmdb.org/t/p/';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** A film as `importFilms` stores it; image fields are TMDB paths, not URLs. */
export type TmdbFilm = {
  tmdbId: number;
  title: string;
  synopsis: string;
  durationMin: number;
  ageRating: string;
  genres: string[];
  posterPath: string;
  backdropPath: string | null;
  trailerUrl: string | null;
  releaseDate: string;
  status: 'now' | 'soon';
};

const IMAGE_PATH = /^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/;
const YOUTUBE_KEY = /^[A-Za-z0-9_-]{6,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const ListSchema = z.object({
  results: z.array(
    z.object({ id: z.number().int().positive(), release_date: z.string().optional() }),
  ),
});

const DetailSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  overview: z.string().nullish(),
  runtime: z.number().nullish(),
  release_date: z.string().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  genres: z.array(z.object({ id: z.number(), name: z.string() })).default([]),
  release_dates: z
    .object({
      results: z.array(
        z.object({
          iso_3166_1: z.string(),
          release_dates: z.array(z.object({ certification: z.string().nullish() })),
        }),
      ),
    })
    .nullish(),
  videos: z
    .object({
      results: z.array(
        z.object({
          site: z.string(),
          type: z.string(),
          key: z.string(),
          official: z.boolean().nullish(),
        }),
      ),
    })
    .nullish(),
});
type Detail = z.infer<typeof DetailSchema>;

/** TMDB genre ids in Mongolian; unknown ids keep TMDB's own name. */
const GENRES_MN: Record<number, string> = {
  28: 'Тулаант',
  12: 'Адал явдалт',
  16: 'Хүүхэлдэйн',
  35: 'Инээдмийн',
  80: 'Гэмт хэрэг',
  99: 'Баримтат',
  18: 'Драм',
  10751: 'Гэр бүл',
  14: 'Уран зөгнөлт',
  36: 'Түүхэн',
  27: 'Аймшгийн',
  10402: 'Хөгжим',
  9648: 'Нууцлаг',
  10749: 'Романтик',
  878: 'Шинжлэх ухааны уран зөгнөлт',
  10770: 'ТВ кино',
  53: 'Триллер',
  10752: 'Дайны',
  37: 'Вестерн',
};

const US_RATINGS: Record<string, string> = {
  G: '0+',
  PG: '6+',
  'PG-13': '12+',
  R: '16+',
  'NC-17': '18+',
};

/** Age rating from the region's certification, then the US one. */
export function ageRatingOf(d: Pick<Detail, 'release_dates'>, region: string): string {
  const certOf = (country: string) =>
    d.release_dates?.results
      .find((r) => r.iso_3166_1 === country)
      ?.release_dates.map((r) => r.certification?.trim() ?? '')
      .find((c) => c !== '');
  for (const country of [region, 'US']) {
    const cert = certOf(country);
    if (!cert) continue;
    const us = US_RATINGS[cert.toUpperCase()];
    if (us) return us;
    const n = cert.match(/\d{1,2}/)?.[0];
    if (n) return `${Number(n)}+`;
    if (/^(G|U|ALL|AL|TP|0)$/i.test(cert)) return '0+';
  }
  // ponytail: no certification published yet (common for new releases); 12+ is a guess an admin
  // can correct in the movie editor.
  return '12+';
}

function trailerOf(d: Pick<Detail, 'videos'>): string | null {
  const trailers = (d.videos?.results ?? []).filter(
    (v) => v.site === 'YouTube' && v.type === 'Trailer' && YOUTUBE_KEY.test(v.key),
  );
  const pick = trailers.find((v) => v.official) ?? trailers[0];
  return pick ? `https://www.youtube.com/watch?v=${pick.key}` : null;
}

const imagePath = (p: string | null | undefined) => (p && IMAGE_PATH.test(p) ? p : null);

/** Attempts per request when TMDB answers 429; each waits what Retry-After asks (capped). */
const RATE_LIMIT_TRIES = 3;
const MAX_WAIT_MS = 10_000;

/** How long a 429 asks us to wait: Retry-After seconds, 2 s when missing, never above the cap. */
export function retryAfterMs(header: string | null): number {
  const s = Number(header);
  return Math.min(MAX_WAIT_MS, Number.isFinite(s) && s > 0 ? s * 1000 : 2000);
}

async function getJson(
  fetchFn: FetchFn,
  token: string,
  path: string,
  params: Record<string, string>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 1; ; attempt++) {
    const res = await fetchFn(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429 && attempt < RATE_LIMIT_TRIES) {
      await sleep(retryAfterMs(res.headers.get('retry-after')));
      continue;
    }
    if (res.status === 401) throw new Error('TMDB refused the token (TMDB_READ_TOKEN)');
    if (!res.ok) throw new Error(`TMDB ${path}: HTTP ${res.status}`);
    return res.json() as Promise<unknown>;
  }
}

/**
 * Films in cinemas now (status now) and opening soon (status soon, released after today), with
 * Mongolian text where TMDB has it and English otherwise. Films without a poster or a known
 * running time are skipped (a schedule cannot be built without the length).
 */
export async function fetchBoxOffice(o: {
  token: string;
  region: string;
  nowLimit?: number;
  soonLimit?: number;
  now?: Date;
  fetchFn?: FetchFn;
  /** Waits between 429 retries (tests pass an instant one). */
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ films: TmdbFilm[]; skipped: string[] }> {
  const fetchFn = o.fetchFn ?? ((url, init) => fetch(url, init));
  const today = ubDate(o.now ?? new Date());
  const list = async (path: string) =>
    ListSchema.parse(
      await getJson(fetchFn, o.token, path, { region: o.region, page: '1' }, o.sleep),
    ).results;

  const nowIds = (await list('/movie/now_playing')).slice(0, o.nowLimit ?? 12).map((r) => r.id);
  const soonIds = (await list('/movie/upcoming'))
    .filter((r) => !nowIds.includes(r.id) && r.release_date && r.release_date > today)
    .slice(0, o.soonLimit ?? 6)
    .map((r) => r.id);

  const films: TmdbFilm[] = [];
  const skipped: string[] = [];
  for (const [id, status] of [
    ...nowIds.map((id) => [id, 'now'] as const),
    ...soonIds.map((id) => [id, 'soon'] as const),
  ]) {
    const d = DetailSchema.parse(
      await getJson(
        fetchFn,
        o.token,
        `/movie/${id}`,
        {
          language: 'mn-MN',
          append_to_response: 'release_dates,videos',
        },
        o.sleep,
      ),
    );
    let synopsis = d.overview?.trim() ?? '';
    if (!synopsis) {
      const en = DetailSchema.parse(
        await getJson(fetchFn, o.token, `/movie/${id}`, { language: 'en-US' }, o.sleep),
      );
      synopsis = en.overview?.trim() ?? '';
    }
    const posterPath = imagePath(d.poster_path);
    const durationMin = Math.round(d.runtime ?? 0);
    if (!posterPath || durationMin <= 0) {
      skipped.push(`${d.title} (${!posterPath ? 'no poster' : 'no running time'})`);
      continue;
    }
    films.push({
      tmdbId: d.id,
      title: d.title.trim().slice(0, 200),
      synopsis: synopsis.slice(0, 5000),
      durationMin: Math.min(durationMin, 600),
      ageRating: ageRatingOf(d, o.region),
      genres: d.genres.slice(0, 10).map((g) => GENRES_MN[g.id] ?? g.name.slice(0, 40)),
      posterPath,
      backdropPath: imagePath(d.backdrop_path),
      trailerUrl: trailerOf(d),
      releaseDate: d.release_date && DATE.test(d.release_date) ? d.release_date : addDays(today, 0),
      status,
    });
  }
  return { films, skipped };
}

/** Downloads one TMDB image (`size` like w780) with a size cap; nothing else is ever fetched. */
export async function downloadTmdbImage(
  size: 'w780' | 'w1280',
  path: string,
  fetchFn: FetchFn = (url, init) => fetch(url, init),
): Promise<Buffer> {
  if (!IMAGE_PATH.test(path)) throw new Error(`bad TMDB image path ${path}`);
  const res = await fetchFn(`${TMDB_IMAGE}${size}${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`TMDB image ${path}: HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) {
    throw new Error(`TMDB image ${path} too large`);
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_IMAGE_BYTES) throw new Error(`TMDB image ${path} too large`);
  return body;
}
