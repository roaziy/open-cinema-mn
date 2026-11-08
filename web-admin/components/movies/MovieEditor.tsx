'use client';

import type { AdminMovie } from '@open-cinema/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { CallError, call, messageOf } from '@/lib/client-api';
import { suggestTone } from '@/lib/tone';
import { ImagePicker } from './ImagePicker';
import { MovieFields } from './MovieFields';
import { MoviePreview } from './MoviePreview';
import { type Form, initialForm, toBody } from './movieForm';
import { ToneField } from './ToneField';

export function MovieEditor({ movie }: { movie: AdminMovie | null }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(() => initialForm(movie));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [toneSuggested, setToneSuggested] = useState(false);
  const [uploads, setUploads] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const [pending, start] = useTransition();

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setSaved(false);
    setF((old) => ({ ...old, [k]: v }));
  };
  const uploading = uploads > 0;
  const onBusy = (busy: boolean) => setUploads((n) => n + (busy ? 1 : -1));

  async function onPoster(url: string, file: File) {
    set('posterUrl', url);
    try {
      set('tone', await suggestTone(file));
      setToneSuggested(true);
    } catch {
      /* the picker keeps whatever tone was there */
    }
  }

  function save() {
    const r = toBody(f);
    if (!r.ok) return setErrors(r.problems);
    setErrors([]);
    start(async () => {
      try {
        if (movie) {
          await call('PATCH', `/admin/movies/${movie.id}`, r.body);
          setSaved(true);
          router.refresh();
        } else {
          const created = await call<AdminMovie>('POST', '/admin/movies', r.body);
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

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!uploading) save();
        }}
      >
        <MovieFields f={f} set={set} />

        <section className="highlight rounded-panel border border-hairline bg-raised p-5">
          <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
            <ImagePicker
              label="Постер"
              url={f.posterUrl || null}
              aspect="aspect-[2/3]"
              onUploaded={onPoster}
              onError={(m) => setErrors([m])}
              onBusy={onBusy}
            />
            <div className="space-y-4">
              <ImagePicker
                label="Арын зураг (заавал биш)"
                url={f.backdropUrl || null}
                aspect="aspect-[16/7]"
                onUploaded={(url) => set('backdropUrl', url)}
                onError={(m) => setErrors([m])}
                onBusy={onBusy}
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

        {errors.map((e) => (
          <Notice key={e}>{e}</Notice>
        ))}
        {deleteBlocked && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-hue-yellow/30 bg-hue-yellow/10 px-4 py-3 text-[13px] text-body">
            Сеанстай киног устгах боломжгүй. Оронд нь архивлаж, жагсаалтаас нууж болно.
            <Button size="sm" onClick={archive} disabled={pending}>
              Архивлах
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending || uploading}>
            {uploading
              ? 'Зураг байршуулж байна…'
              : pending
                ? 'Хадгалж байна…'
                : movie
                  ? 'Хадгалах'
                  : 'Кино нэмэх'}
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
      <MoviePreview f={f} />
    </div>
  );
}
