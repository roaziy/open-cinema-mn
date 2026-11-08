'use client';

import { X } from '@phosphor-icons/react/dist/ssr';
import { type KeyboardEvent, useState } from 'react';

/** Chips with a trailing text box: Enter or comma adds, Backspace on an empty box removes the last. */
export function GenreInput({
  id,
  genres,
  onChange,
}: {
  id: string;
  genres: string[];
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState('');

  function add() {
    const g = text.trim().replace(/,$/, '');
    if (g && !genres.includes(g) && genres.length < 10) onChange([...genres, g]);
    setText('');
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !text && genres.length) {
      onChange(genres.slice(0, -1));
    }
  }

  return (
    <div className="focus-within:border-action/70 flex min-h-11 flex-wrap items-center gap-1.5 rounded-card border border-hairline bg-raised px-2 py-1.5">
      {genres.map((g) => (
        <span
          key={g}
          className="inline-flex items-center gap-1 rounded-full bg-fill py-1 pl-2.5 pr-1.5 text-[13px] text-ink"
        >
          {g}
          <button
            type="button"
            aria-label={`${g} хасах`}
            onClick={() => onChange(genres.filter((x) => x !== g))}
            className="focus-ring rounded-full p-0.5 text-muted hover:text-ink"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        className="min-w-24 flex-1 bg-transparent px-1.5 py-1 text-[15px] text-ink outline-none placeholder:text-muted/70"
        placeholder={genres.length ? '' : 'Жишээ нь Драма'}
      />
    </div>
  );
}
