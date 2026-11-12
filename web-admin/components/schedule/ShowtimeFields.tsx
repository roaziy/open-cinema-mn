'use client';

import { useState } from 'react';
import { Labeled, Select, TextInput } from '@/components/ui/Inputs';
import { ubInstant } from '@/lib/format';
import { type AdminMovie, type AdminShowtime, formatUbTime, ubDate } from '@/lib/shared';
import type { DrawerTarget, HallOption } from './ShowtimeDrawer';

export const FORMATS = ['2D', '3D', 'IMAX'] as const;

/** Form state of the showing drawer. Start values come from the showing being edited or the click. */
export function useShowtimeDraft(
  target: DrawerTarget | null,
  movies: AdminMovie[],
  halls: HallOption[],
) {
  const editing = target?.mode === 'edit' ? target.showtime : null;
  const create = target?.mode === 'create' ? target : null;
  const [movieId, setMovieId] = useState(
    editing?.movieId ?? movies.find((m) => m.status === 'now')?.id ?? movies[0]?.id ?? '',
  );
  const [hallId, setHallId] = useState(editing?.hallId ?? create?.hallId ?? halls[0]?.id ?? '');
  const [date, setDate] = useState(editing ? ubDate(editing.startsAt) : (create?.date ?? ''));
  const [time, setTime] = useState(
    editing ? formatUbTime(editing.startsAt) : (create?.time ?? '18:00'),
  );
  const [format, setFormat] = useState<(typeof FORMATS)[number]>(editing?.format ?? '2D');
  const [std, setStd] = useState(String(editing?.priceStandard ?? 15000));
  const [prem, setPrem] = useState(String(editing?.pricePremium ?? 22000));
  return {
    values: {
      movieId,
      hallId,
      startsAt: date && time ? ubInstant(date, time) : '',
      format,
      priceStandard: Number(std),
      pricePremium: Number(prem),
    },
    fields: {
      movieId,
      setMovieId,
      hallId,
      setHallId,
      date,
      setDate,
      time,
      setTime,
      format,
      setFormat,
      std,
      setStd,
      prem,
      setPrem,
    },
  };
}

type Fields = ReturnType<typeof useShowtimeDraft>['fields'];

export function ShowtimeFields({
  f,
  movies,
  halls,
  editing,
  structureLocked,
  pricesLocked,
}: {
  f: Fields;
  movies: AdminMovie[];
  halls: HallOption[];
  editing: AdminShowtime | null;
  /** Tickets are sold (or the showing is over): only prices may change. */
  structureLocked: boolean;
  /** Cancelled or started: nothing may change. */
  pricesLocked: boolean;
}) {
  const movie = movies.find((m) => m.id === f.movieId);
  return (
    <div className="space-y-4">
      <fieldset disabled={structureLocked} className="space-y-4 disabled:opacity-60">
        <Labeled
          label="Кино"
          htmlFor="t-movie"
          hint={movie ? `Үргэлжлэх хугацаа ${movie.durationMin} мин` : undefined}
        >
          <Select
            id="t-movie"
            data-autofocus
            value={f.movieId}
            onChange={(e) => f.setMovieId(e.target.value)}
          >
            {movies
              .filter((m) => m.status !== 'archived' || m.id === f.movieId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
          </Select>
        </Labeled>
        <Labeled label="Заал" htmlFor="t-hall">
          <Select id="t-hall" value={f.hallId} onChange={(e) => f.setHallId(e.target.value)}>
            {halls.map((h) => (
              <option key={h.id} value={h.id}>
                {h.branchName} · {h.name}
              </option>
            ))}
          </Select>
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Огноо" htmlFor="t-date">
            <TextInput
              id="t-date"
              type="date"
              value={f.date}
              onChange={(e) => f.setDate(e.target.value)}
            />
          </Labeled>
          <Labeled label="Эхлэх цаг" htmlFor="t-time">
            <TextInput
              id="t-time"
              type="time"
              step={300}
              value={f.time}
              onChange={(e) => f.setTime(e.target.value)}
            />
          </Labeled>
        </div>
        <Labeled label="Формат" htmlFor="t-format">
          <Select
            id="t-format"
            value={f.format}
            onChange={(e) => f.setFormat(e.target.value as typeof f.format)}
          >
            {FORMATS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </Labeled>
      </fieldset>
      <fieldset disabled={pricesLocked} className="grid grid-cols-2 gap-3 disabled:opacity-60">
        <Labeled label="Энгийн суудлын үнэ (₮)" htmlFor="t-std">
          <TextInput
            id="t-std"
            type="number"
            inputMode="numeric"
            step={500}
            min={0}
            value={f.std}
            onChange={(e) => f.setStd(e.target.value)}
          />
        </Labeled>
        <Labeled label="Премиум суудлын үнэ (₮)" htmlFor="t-prem">
          <TextInput
            id="t-prem"
            type="number"
            inputMode="numeric"
            step={500}
            min={0}
            value={f.prem}
            onChange={(e) => f.setPrem(e.target.value)}
          />
        </Labeled>
      </fieldset>
      {editing && editing.sold > 0 && !pricesLocked && (
        <p className="text-xs text-muted">
          Тасалбар зарагдсан сеансын кино, заал, цаг, форматыг өөрчлөх боломжгүй. Үнийг л өөрчилж
          болно, өмнө төлсөн захиалгад нөлөөлөхгүй.
        </p>
      )}
    </div>
  );
}
