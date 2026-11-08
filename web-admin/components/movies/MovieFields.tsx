'use client';

import { Labeled, Select, TextArea, TextInput } from '@/components/ui/Inputs';
import { GenreInput } from './GenreInput';
import type { Form } from './movieForm';

/** The text fields of the movie form. */
export function MovieFields({
  f,
  set,
}: {
  f: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
}) {
  return (
    <section className="highlight grid gap-4 rounded-panel border border-hairline bg-raised p-5 sm:grid-cols-2">
      <Labeled label="Нэр" htmlFor="m-title" className="sm:col-span-2">
        <TextInput
          id="m-title"
          value={f.title}
          maxLength={200}
          onChange={(e) => set('title', e.target.value)}
        />
      </Labeled>
      <Labeled label="Тайлбар" htmlFor="m-syn" className="sm:col-span-2">
        <TextArea
          id="m-syn"
          rows={4}
          value={f.synopsis}
          onChange={(e) => set('synopsis', e.target.value)}
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
          maxLength={10}
          value={f.ageRating}
          onChange={(e) => set('ageRating', e.target.value)}
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
        <GenreInput id="m-genre" genres={f.genres} onChange={(g) => set('genres', g)} />
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
  );
}
