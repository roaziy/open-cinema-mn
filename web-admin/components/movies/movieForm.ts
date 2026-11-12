import { todayUb } from '@/lib/format';
import { type AdminMovie, AdminMovieBody } from '@/lib/shared';

export type Form = {
  title: string;
  synopsis: string;
  durationMin: string;
  ageRating: string;
  genres: string[];
  posterUrl: string;
  backdropUrl: string;
  trailerUrl: string;
  tone: string;
  releaseDate: string;
  status: AdminMovie['status'];
};

const FIELD_LABEL: Record<string, string> = {
  title: 'Нэр',
  synopsis: 'Тайлбар',
  durationMin: 'Үргэлжлэх хугацаа',
  ageRating: 'Насны ангилал',
  genres: 'Төрөл',
  posterUrl: 'Постер',
  backdropUrl: 'Арын зураг',
  trailerUrl: 'Трейлер холбоос',
  tone: 'Өнгө',
  releaseDate: 'Гарах огноо',
};

export function initialForm(m: AdminMovie | null): Form {
  return {
    title: m?.title ?? '',
    synopsis: m?.synopsis ?? '',
    durationMin: m ? String(m.durationMin) : '',
    ageRating: m?.ageRating ?? '',
    genres: m?.genres ?? [],
    posterUrl: m?.posterUrl ?? '',
    backdropUrl: m?.backdropUrl ?? '',
    trailerUrl: m?.trailerUrl ?? '',
    tone: m?.tone ?? '#2E6BF0',
    releaseDate: m?.releaseDate ?? todayUb(),
    status: m?.status ?? 'soon',
  };
}

/** The API body for a form, or the Mongolian names of the fields that are wrong. */
export function toBody(
  f: Form,
): { ok: true; body: AdminMovieBody } | { ok: false; problems: string[] } {
  const parsed = AdminMovieBody.safeParse({
    title: f.title,
    synopsis: f.synopsis,
    durationMin: f.durationMin === '' ? Number.NaN : Number(f.durationMin),
    ageRating: f.ageRating,
    genres: f.genres,
    posterUrl: f.posterUrl,
    backdropUrl: f.backdropUrl || null,
    trailerUrl: f.trailerUrl || null,
    tone: f.tone,
    releaseDate: f.releaseDate,
    status: f.status,
  });
  if (parsed.success) return { ok: true, body: parsed.data };
  const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
  return {
    ok: false,
    problems: names.map((n) => `${FIELD_LABEL[n] ?? n}: буруу эсвэл дутуу байна`),
  };
}
