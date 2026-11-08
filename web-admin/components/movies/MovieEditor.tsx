'use client';

import { type AdminMovie, AdminMovieBody } from '@open-cinema/shared';
import { X } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Labeled, Select, TextArea, TextInput } from '@/components/ui/Inputs';
import { Notice } from '@/components/ui/Notice';
import { CallError, call, messageOf } from '@/lib/client-api';
import { dayMonth, todayUb } from '@/lib/format';
import { suggestTone } from '@/lib/tone';
import { ImagePicker } from './ImagePicker';
import { ToneField } from './ToneField';

type Form = {
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

function initial(m: AdminMovie | null): Form {
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

export function MovieEditor({ movie }: { movie: AdminMovie | null }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(() => initial(movie));
  const [genre, setGenre] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [toneSuggested, setToneSuggested] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setSaved(false);
    setF((old) => ({ ...old, [k]: v }));
  };

  function addGenre() {
    const g = genre.trim().replace(/,$/, '');
    if (g && !f.genres.includes(g) && f.genres.length < 10) set('genres', [...f.genres, g]);
    setGenre('');
  }
  function onGenreKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addGenre();
    } else if (e.key === 'Backspace' && !genre && f.genres.length) {
      set('genres', f.genres.slice(0, -1));
    }
  }

  async function onPoster(url: string, file: File) {
    set('posterUrl', url);
    try {
      const tone = await suggestTone(file);
      set('tone', tone);
      setToneSuggested(true);
    } catch {
      /* the picker keeps whatever tone was there */
    }
  }

  function save() {
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
    if (!parsed.success) {
      const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
      setErrors(names.map((n) => `${FIELD_LABEL[n] ?? n}: буруу эсвэл дутуу байна`));
      return;
    }
    setErrors([]);
    start(async () => {
      try {
        if (movie) {
          await call('PATCH', `/admin/movies/${movie.id}`, parsed.data);
          setSaved(true);
          router.refresh();
        } else {
          const created = await call<AdminMovie>('POST', '/admin/movies', parsed.data);
          router.replace(`/admin/movies/${created.id}`);
        }
      } catch (err) {
        setErrors([messageOf(err)]);
      }
    });
  }

  function remove() {
    if (!movie) return;
    start(async () => {
      try {
        await call('DELETE', `/admin/movies/${movie.id}`);
        router.replace('/admin/movies');
      } catch (err) {
        setConfirmDelete(false);
        if (err instanceof CallError && err.code === 'in_use') setDeleteBlocked(true);
        else setErrors([messageOf(err)]);
      }
    });
  }

  function archive() {
    if (!movie) return;
    start(async () => {
      try {
        await call('PATCH', `/admin/movies/${movie.id}`, { status: 'archived' });
        router.replace('/admin/movies');
      } catch (err) {
        setErrors([messageOf(err)]);
      }
    });
  }

  const backdrop = f.backdropUrl || f.posterUrl;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <section className="highlight grid gap-4 rounded-panel border border-hairline bg-raised p-5 sm:grid-cols-2">
          <Labeled label="Нэр" htmlFor="m-title" className="sm:col-span-2">
            <TextInput
              id="m-title"
              value={f.title}
              onChange={(e) => set('title', e.target.value)}
              maxLength={200}
            />
          </Labeled>
          <Labeled label="Тайлбар" htmlFor="m-syn" className="sm:col-span-2">
            <TextArea
              id="m-syn"
              value={f.synopsis}
              onChange={(e) => set('synopsis', e.target.value)}
              rows={4}
            />
          </Labeled>
          <Labeled label="Үргэлжлэх хугацаа (мин)" htmlFor="m-dur">
            <TextInput
              id="m-dur"
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              value={f.durationMin}
              onChange={(e) => set('durationMin', e.target.value)}
            />
          </Labeled>
          <Labeled label="Насны ангилал" htmlFor="m-age" hint="Жишээ нь 12+, 16+">
            <TextInput
              id="m-age"
              value={f.ageRating}
              onChange={(e) => set('ageRating', e.target.value)}
              maxLength={10}
            />
          </Labeled>
          <Labeled label="Гарах огноо" htmlFor="m-date">
            <TextInput
              id="m-date"
              type="date"
              value={f.releaseDate}
              onChange={(e) => set('releaseDate', e.target.value)}
            />
          </Labeled>
          <Labeled label="Төлөв" htmlFor="m-status">
            <Select
              id="m-status"
              value={f.status}
              onChange={(e) => set('status', e.target.value as Form['status'])}
            >
              <option value="now">Үзүүлж байгаа</option>
              <option value="soon">Удахгүй</option>
              <option value="archived">Архив</option>
            </Select>
          </Labeled>
          <Labeled
            label="Төрөл"
            htmlFor="m-genre"
            className="sm:col-span-2"
            hint="Enter эсвэл таслалаар нэмнэ"
          >
            <div className="focus-within:border-action/70 flex min-h-11 flex-wrap items-center gap-1.5 rounded-card border border-hairline bg-raised px-2 py-1.5">
              {f.genres.map((g) => (
                <span
                  key={g}
                  className="inline-flex items-center gap-1 rounded-full bg-fill py-1 pl-2.5 pr-1.5 text-[13px] text-ink"
                >
                  {g}
                  <button
                    type="button"
                    aria-label={`${g} хасах`}
                    onClick={() =>
                      set(
                        'genres',
                        f.genres.filter((x) => x !== g),
                      )
                    }
                    className="focus-ring rounded-full p-0.5 text-muted hover:text-ink"
                  >
                    <X size={12} weight="bold" />
                  </button>
                </span>
              ))}
              <input
                id="m-genre"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                onKeyDown={onGenreKey}
                onBlur={addGenre}
                className="min-w-24 flex-1 bg-transparent px-1.5 py-1 text-[15px] text-ink outline-none placeholder:text-muted/70"
                placeholder={f.genres.length ? '' : 'Жишээ нь Драма'}
              />
            </div>
          </Labeled>
          <Labeled label="Трейлер холбоос" htmlFor="m-trailer" className="sm:col-span-2">
            <TextInput
              id="m-trailer"
              type="url"
              placeholder="https://"
              value={f.trailerUrl}
              onChange={(e) => set('trailerUrl', e.target.value)}
            />
          </Labeled>
        </section>

        <section className="highlight rounded-panel border border-hairline bg-raised p-5">
          <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
            <ImagePicker
              label="Постер"
              url={f.posterUrl || null}
              aspect="aspect-[2/3]"
              onUploaded={onPoster}
              onError={(m) => setErrors([m])}
            />
            <div className="space-y-4">
              <ImagePicker
                label="Арын зураг (заавал биш)"
                url={f.backdropUrl || null}
                aspect="aspect-[16/7]"
                onUploaded={(url) => set('backdropUrl', url)}
                onError={(m) => setErrors([m])}
              />
              <ToneField
                value={f.tone}
                suggested={toneSuggested}
                onChange={(hex) => {
                  setToneSuggested(false);
                  set('tone', hex);
                }}
              />
            </div>
          </div>
        </section>

        {errors.length > 0 && (
          <div className="space-y-2">
            {errors.map((e) => (
              <Notice key={e}>{e}</Notice>
            ))}
          </div>
        )}
        {deleteBlocked && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-hue-yellow/30 bg-hue-yellow/10 px-4 py-3 text-[13px] text-body">
            Сеанстай киног устгах боломжгүй. Оронд нь архивлаж, жагсаалтаас нууж болно.
            <Button size="sm" onClick={archive} disabled={pending}>
              Архивлах
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Хадгалж байна…' : movie ? 'Хадгалах' : 'Кино нэмэх'}
          </Button>
          {saved && (
            <span role="status" className="text-[13px] text-success">
              Хадгаллаа
            </span>
          )}
          {movie && (
            <div className="ml-auto flex items-center gap-2">
              {confirmDelete ? (
                <>
                  <span className="text-[13px] text-muted">Устгах уу?</span>
                  <Button variant="danger" size="sm" onClick={remove} disabled={pending}>
                    Тийм, устга
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    Болих
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                  Устгах
                </Button>
              )}
            </div>
          )}
        </div>
      </form>

      <aside aria-label="Урьдчилан харах" className="xl:sticky xl:top-5 xl:self-start">
        <div className="highlight relative overflow-hidden rounded-panel border border-hairline bg-canvas">
          {backdrop && (
            // biome-ignore lint/performance/noImgElement: arbitrary storage host
            <img
              src={backdrop}
              alt=""
              aria-hidden
              className="absolute inset-0 size-full scale-125 object-cover opacity-60 blur-2xl"
            />
          )}
          <div className="absolute inset-0 bg-black/35" />
          <div className="relative p-5">
            <div
              className="mx-auto w-[150px] overflow-hidden rounded-card border border-white/10 bg-fill"
              style={{ aspectRatio: '2 / 3' }}
            >
              {f.posterUrl && (
                // biome-ignore lint/performance/noImgElement: arbitrary storage host
                <img src={f.posterUrl} alt="" className="size-full object-cover" />
              )}
            </div>
            <p className="mt-4 text-center text-lg font-semibold text-ink">
              {f.title || 'Киноны нэр'}
            </p>
            <p className="mt-0.5 text-center text-[13px] text-body">
              {[
                f.ageRating,
                f.durationMin && `${f.durationMin} мин`,
                f.releaseDate && dayMonth(f.releaseDate),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div
              className="mt-4 flex items-center justify-between rounded-card px-3.5 py-2.5 text-[13px] font-medium text-white"
              style={{ background: f.tone }}
            >
              <span>Тасалбарын зурвас</span>
              <span className="tabular-nums">{f.tone.toUpperCase()}</span>
            </div>
          </div>
        </div>
        <p className="mt-2 px-1 text-xs text-muted">
          Апп дээр постер, суудлын дэлгэцийн гэрэл, тасалбарт энэ өнгө хэрэглэгдэнэ.
        </p>
      </aside>
    </div>
  );
}
