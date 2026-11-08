'use client';

import { Labeled, TextInput } from '@/components/ui/Inputs';
import type { Raw } from './useHallDraft';

const NUMBERS: { key: keyof Raw; label: string; step: string }[] = [
  { key: 'rows', label: 'Эгнээ', step: '1' },
  { key: 'seatsPerRow', label: 'Эгнээн дэх суудал', step: '1' },
  { key: 'seatPitchM', label: 'Суудлын зай (м)', step: '0.05' },
  { key: 'rowSpacingM', label: 'Эгнээний зай (м)', step: '0.05' },
  { key: 'firstRowDistanceM', label: '1-р эгнээ хүртэл (м)', step: '0.1' },
  { key: 'risePerRowM', label: 'Эгнээ тутмын өндөр (м)', step: '0.05' },
];

/** The generator's numbers and aisle list. `locked` halls keep their layout. */
export function GeneratorFields({
  raw,
  setRaw,
  locked,
}: {
  raw: Raw;
  setRaw: (key: keyof Raw, value: string) => void;
  locked: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {NUMBERS.map((n) => (
          <Labeled key={n.key} label={n.label} htmlFor={`g-${n.key}`}>
            <TextInput
              id={`g-${n.key}`}
              type="number"
              inputMode="decimal"
              step={n.step}
              min={0}
              value={raw[n.key]}
              disabled={locked}
              onChange={(e) => setRaw(n.key, e.target.value)}
            />
          </Labeled>
        ))}
      </div>
      <Labeled
        label="Явган замын байрлал"
        htmlFor="g-aisle"
        hint="Аль суудлын дараа зай гарахыг таслалаар. Жишээ нь 7, 14"
      >
        <TextInput
          id="g-aisle"
          value={raw.aisleAfter}
          disabled={locked}
          onChange={(e) => setRaw('aisleAfter', e.target.value)}
        />
      </Labeled>
    </>
  );
}
