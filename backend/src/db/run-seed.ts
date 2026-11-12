import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { hash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { BACKEND_ROOT } from '../lib/paths';
import { generateSeats, type HallGenParams, ubDate, ubDayRange } from '../shared';
import type { StorageProvider } from '../storage';
import type { Db } from './client';
import { branches, halls, movies, seats, showtimes, users } from './schema';

const MEDIA_DIR = path.join(BACKEND_ROOT, 'seed/media');
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const PREMIUM_EXTRA = 7000;

type FilmSeed = {
  slug: string;
  title: string;
  tone: string;
  genre: string;
  durationMin: number;
  ageRating: string;
  /** Days from today: <= 0 is already showing, > 0 is coming soon. */
  releaseOffsetDays: number;
  synopsis: string;
};

const FILMS: FilmSeed[] = [
  {
    slug: 'talyn-salkhi',
    title: 'Талын салхи',
    tone: '#3D6FC2',
    genre: 'Драм',
    durationMin: 128,
    ageRating: '16+',
    releaseOffsetDays: -21,
    synopsis:
      'Хот руу явсан эгч нь гэнэт буцаж ирэхэд хоёр дүүгийн нам гүм өвөл самуурна. Талын салхи хуучин зөрчлийг ил гаргаж, тэд эцсийн шийдвэрээ гаргахаас өөр аргагүй болно.',
  },
  {
    slug: 'shuniin-shugam',
    title: 'Шөнийн шугам',
    tone: '#E63B2E',
    genre: 'Триллер',
    durationMin: 112,
    ageRating: '18+',
    releaseOffsetDays: -14,
    synopsis:
      'Шөнийн автобусны жолооч сүүлчийн эргэлтдээ нэг сэжигтэй зорчигч тээнэ. Үүр цайхаас өмнө тэр өөрийн өнгөрсөн нууцтай нүүр тулах ёстой болно.',
  },
  {
    slug: 'musun-gol',
    title: 'Мөсөн гол',
    tone: '#3B7C99',
    genre: 'Адал явдал',
    durationMin: 104,
    ageRating: '12+',
    releaseOffsetDays: -7,
    synopsis:
      'Гурван хүүхэд өвлийн амралтаараа хөлдсөн голын дагуу өвөөгийнхөө нутаг руу явахаар шийднэ. Нимгэн мөс, ширүүн цаг агаар тэдний нөхөрлөлийг хамгийн хатуу шалгалтад оруулна.',
  },
  {
    slug: 'ulaan-mori',
    title: 'Улаан морь',
    tone: '#B3262B',
    genre: 'Түүхэн',
    durationMin: 141,
    ageRating: '16+',
    releaseOffsetDays: 12,
    synopsis:
      'Өнгөрсөн зууны эхээр нэгэн малчин өвөг дээдсийнхээ өв болсон улаан морийг аврахаар хол газар зорино. Түүний аялал нэг гэр бүлийн төдийгүй бүхэл бүтэн үеийн түүхийг өгүүлнэ.',
  },
  {
    slug: 'baga-khot',
    title: 'Бага хот',
    tone: '#F4C542',
    genre: 'Хүүхэлдэйн кино',
    durationMin: 91,
    ageRating: '0+',
    releaseOffsetDays: -28,
    synopsis:
      'Тоглоомын дэлгүүрийн тавиур дээрх жижигхэн хотод тоглоомууд шөнө бүр амилдаг. Шинэ тоглоом ирэхэд тэд хамтдаа хотоо аврах нууц даалгавар авна.',
  },
  {
    slug: 'dokhio',
    title: 'Дохио',
    tone: '#2F7F74',
    genre: 'Уран зөгнөлт',
    durationMin: 122,
    ageRating: '12+',
    releaseOffsetDays: 26,
    synopsis:
      'Алслагдсан ажиглалтын цэгийн инженер тэнгэрээс ирсэн нууцлаг дохио хүлээн авна. Тэр дохиог тайлах тусам өөрийн санаж буй дурсамжууд үнэн эсэхэд эргэлзэж эхэлнэ.',
  },
];

type HallSeed = { name: string; params: HallGenParams; imax?: boolean; threeD?: boolean };

const hallParams = (rows: number, seatsPerRow: number, aisleAfter: number[]): HallGenParams => ({
  rows,
  seatsPerRow,
  seatPitchM: 0.55,
  rowSpacingM: 1.05,
  aisleAfter,
  firstRowDistanceM: 4.5,
  risePerRowM: 0.2,
});

const BRANCHES: {
  name: string;
  address: string;
  lat: number;
  lng: number;
  halls: HallSeed[];
}[] = [
  {
    name: 'Төв салбар',
    address: 'Сүхбаатар дүүрэг, 1-р хороо, Чингисийн өргөн чөлөө 15, Улаанбаатар',
    lat: 47.9186,
    lng: 106.9177,
    halls: [
      { name: 'Танхим 1 · IMAX', params: hallParams(14, 18, [6, 12]), imax: true },
      { name: 'Танхим 2', params: hallParams(12, 14, [7]), threeD: true },
      { name: 'Танхим 3', params: hallParams(10, 12, [6]) },
      { name: 'Танхим 4', params: hallParams(10, 12, [6]) },
    ],
  },
  {
    name: 'Зайсан салбар',
    address: 'Хан-Уул дүүрэг, 15-р хороо, Зайсан толгойн зам 8, Улаанбаатар',
    lat: 47.8861,
    lng: 106.9063,
    halls: [
      { name: 'Танхим 1', params: hallParams(12, 16, [8]), threeD: true },
      { name: 'Танхим 2', params: hallParams(10, 14, [7]) },
      { name: 'Танхим 3', params: hallParams(10, 12, [6]) },
    ],
  },
  {
    name: 'Яармаг салбар',
    address: 'Хан-Уул дүүрэг, 11-р хороо, Яармагийн уулзвар 3, Улаанбаатар',
    lat: 47.8593,
    lng: 106.7871,
    halls: [
      { name: 'Танхим 1', params: hallParams(11, 14, [7]), threeD: true },
      { name: 'Танхим 2', params: hallParams(10, 12, [6]) },
    ],
  },
];

export type SeedOptions = {
  db: Db;
  storage: StorageProvider;
  now: Date;
  nodeEnv: string;
  adminEmail: string;
  adminPassword: string;
  mediaDir?: string;
  days?: number;
};

export type SeedSummary = { branches: number; halls: number; films: number; showtimes: number };

/** UB calendar date `offset` days after `from` (a YYYY-MM-DD date). */
function addDays(from: string, offset: number): string {
  const noon = ubDayRange(from).start.getTime() + 12 * 60 * MIN_MS;
  return ubDate(new Date(noon + offset * DAY_MS));
}

function priceFor(date: string, startMin: number, imax: boolean): number {
  const weekend = [0, 5, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  if (imax || (weekend && startMin >= 17 * 60)) return 18000;
  return startMin >= 17 * 60 ? 15000 : 12000;
}

/**
 * Shows for one hall and day: first at 10:00-10:30 (UB), then each film's
 * length plus a 20 minute turnaround rounded up to 5 minutes, last start no
 * later than 23:30. Late shows run past midnight.
 */
function planDay(hallIdx: number, dayIdx: number, nowFilms: FilmSeed[]) {
  const plan: { film: FilmSeed; startMin: number }[] = [];
  let cursor = 10 * 60 + (hallIdx % 4) * 10;
  for (let k = 0; cursor <= 23 * 60 + 30; k++) {
    const film = nowFilms[(hallIdx + dayIdx + k) % nowFilms.length] as FilmSeed;
    plan.push({ film, startMin: cursor });
    cursor = Math.ceil((cursor + film.durationMin + 20) / 5) * 5;
  }
  return plan;
}

/** Replaces all domain data with demo data. Development and test only. */
export async function runSeed(opts: SeedOptions): Promise<SeedSummary> {
  if (opts.nodeEnv === 'production') {
    throw new Error('refusing to seed: NODE_ENV=production');
  }
  const { db, storage } = opts;
  const mediaDir = opts.mediaDir ?? MEDIA_DIR;
  const today = ubDate(opts.now);

  // Media first, so a storage failure leaves existing data untouched.
  const posterUrls = new Map<string, string>();
  for (const f of FILMS) {
    const body = await readFile(path.join(mediaDir, `${f.slug}.png`));
    posterUrls.set(f.slug, await storage.put(`posters/${f.slug}.png`, body, 'image/png'));
  }
  const adminHash = await hash(opts.adminPassword);

  return db.transaction(async (tx) => {
    const tables = await tx.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
    );
    const names = tables.rows.map((r) => `"${r.tablename}"`);
    await tx.execute(sql.raw(`truncate table ${names.join(', ')} restart identity cascade`));

    const branchRows = await tx
      .insert(branches)
      .values(BRANCHES.map(({ name, address, lat, lng }) => ({ name, address, lat, lng })))
      .returning();

    const hallDefs = BRANCHES.flatMap((b, bi) =>
      b.halls.map((h) => ({ ...h, branchId: (branchRows[bi] as { id: string }).id })),
    );
    const hallRows = await tx
      .insert(halls)
      .values(
        hallDefs.map((h) => {
          const screenWidthM = h.imax ? 14 : 4 + h.params.seatsPerRow * 0.45;
          return {
            branchId: h.branchId,
            name: h.name,
            screenWidthM,
            screenHeightM: Math.round(screenWidthM * 0.42 * 10) / 10,
            screenXM: 0,
          };
        }),
      )
      .returning();

    const seatValues = hallDefs.flatMap((h, i) =>
      generateSeats(h.params).map((s) => ({
        hallId: (hallRows[i] as { id: string }).id,
        rowLabel: s.rowLabel,
        number: s.number,
        xM: s.x_m,
        yM: s.y_m,
        zM: s.z_m,
        kind:
          s.rowLabel === 'J'
            ? ('premium' as const)
            : s.rowLabel === 'A' && (s.number === 1 || s.number === 12)
              ? ('wheelchair' as const)
              : ('standard' as const),
      })),
    );
    for (let i = 0; i < seatValues.length; i += 1000) {
      await tx.insert(seats).values(seatValues.slice(i, i + 1000));
    }

    const movieRows = await tx
      .insert(movies)
      .values(
        FILMS.map((f) => {
          const url = posterUrls.get(f.slug) as string;
          return {
            title: f.title,
            synopsis: f.synopsis,
            durationMin: f.durationMin,
            ageRating: f.ageRating,
            genres: [f.genre],
            posterUrl: url,
            backdropUrl: url,
            tone: f.tone,
            releaseDate: addDays(today, f.releaseOffsetDays),
            status: f.releaseOffsetDays > 0 ? ('soon' as const) : ('now' as const),
          };
        }),
      )
      .returning();
    const movieId = new Map(FILMS.map((f, i) => [f.slug, (movieRows[i] as { id: string }).id]));
    const nowFilms = FILMS.filter((f) => f.releaseOffsetDays <= 0);

    const showtimeValues: (typeof showtimes.$inferInsert)[] = [];
    for (let d = 0; d < (opts.days ?? 7); d++) {
      const date = addDays(today, d);
      const dayStart = ubDayRange(date).start.getTime();
      hallDefs.forEach((h, hi) => {
        for (const { film, startMin } of planDay(hi, d, nowFilms)) {
          const priceStandard = priceFor(date, startMin, Boolean(h.imax));
          showtimeValues.push({
            movieId: movieId.get(film.slug) as string,
            hallId: (hallRows[hi] as { id: string }).id,
            startsAt: new Date(dayStart + startMin * MIN_MS),
            format: h.imax ? 'IMAX' : h.threeD && film.slug === 'musun-gol' ? '3D' : '2D',
            priceStandard,
            pricePremium: priceStandard + PREMIUM_EXTRA,
          });
        }
      });
    }
    await tx.insert(showtimes).values(showtimeValues);

    const centralId = (branchRows[0] as { id: string }).id;
    await tx.insert(users).values([
      {
        role: 'admin',
        email: opts.adminEmail.trim().toLowerCase(),
        emailVerifiedAt: opts.now,
        passwordHash: adminHash,
        name: 'Админ',
      },
      { role: 'staff', phone: '+97688000001', name: 'Билгүүн', branchId: centralId },
      { role: 'staff', phone: '+97688000002', name: 'Сарнай', branchId: centralId },
    ]);

    return {
      branches: branchRows.length,
      halls: hallRows.length,
      films: movieRows.length,
      showtimes: showtimeValues.length,
    };
  });
}
