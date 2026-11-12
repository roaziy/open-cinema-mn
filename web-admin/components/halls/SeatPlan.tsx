'use client';

import { useRef } from 'react';
import { bounds } from '@/lib/hall-layout';
import type { SeatKind } from '@/lib/shared';
import { KIND_FILL } from './kinds';

export type PlanSeat = {
  key: string;
  rowLabel: string;
  number: number;
  x_m: number;
  y_m: number;
  z_m: number;
  kind: SeatKind;
  /** Differs from what is stored (unsaved paint). */
  changed: boolean;
};

const SCALE = 44;

/**
 * Top-down plan: screen at the top, row 1 nearest it. Painting works with mouse, touch and
 * pen: pointer moves are hit-tested against the seats under the finger, because touches never
 * fire enter events on other elements.
 */
export function SeatPlan({
  seats,
  pitchM,
  screenWidthM,
  screenXM,
  selected,
  onPaint,
  onPaintRow,
  ariaLabel,
}: {
  seats: PlanSeat[];
  pitchM: number;
  screenWidthM: number;
  screenXM: number;
  selected: string | null;
  onPaint: (key: string) => void;
  onPaintRow: (rowLabel: string) => void;
  ariaLabel: string;
}) {
  const down = useRef(false);
  const last = useRef<string | null>(null);
  const b = bounds(seats);
  const gutter = pitchM * 2.2;
  const minX = Math.min(b.minX - gutter, screenXM - screenWidthM / 2) - 0.3;
  const maxX = Math.max(b.maxX + pitchM, screenXM + screenWidthM / 2) + 0.3;
  const top = -1.3;
  const bottom = b.maxY + pitchM * 1.5;
  const scale = SCALE;
  const W = (maxX - minX) * scale;
  const H = Math.max((bottom - top) * scale, 120);
  const px = (x: number) => (x - minX) * scale;
  const py = (y: number) => (y - top) * scale;
  const size = Math.max(Math.min(pitchM * 0.82 * scale, 30), 5);
  const rows = [...new Map(seats.map((s) => [s.rowLabel, s])).values()];
  const fontSize = Math.max(Math.min(size * 0.55, 12), 7);

  const hit = (e: React.PointerEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el?.getAttribute('data-seat') ?? null;
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG canvas cannot be a <fieldset>
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label={ariaLabel}
      className="block h-auto w-full touch-none select-none"
      onPointerDown={(e) => {
        const k = hit(e);
        if (!k) return;
        down.current = true;
        last.current = k;
        onPaint(k);
      }}
      onPointerMove={(e) => {
        if (!down.current) return;
        const k = hit(e);
        if (k && k !== last.current) {
          last.current = k;
          onPaint(k);
        }
      }}
      onPointerUp={() => {
        down.current = false;
        last.current = null;
      }}
      onPointerLeave={() => {
        down.current = false;
        last.current = null;
      }}
    >
      <rect
        x={px(screenXM - screenWidthM / 2)}
        y={py(-0.55)}
        width={screenWidthM * scale}
        height={Math.max(scale * 0.18, 3)}
        rx={2}
        className="fill-ink"
        opacity={0.9}
      />
      <text
        x={px(screenXM)}
        y={py(-0.55) - 8}
        textAnchor="middle"
        fontSize="11"
        className="fill-muted"
      >
        Дэлгэц
      </text>
      {rows.map((r) => (
        // biome-ignore lint/a11y/useSemanticElements: an SVG label cannot be a <button>
        <g
          key={r.rowLabel}
          role="button"
          tabIndex={0}
          aria-label={`${r.rowLabel} эгнээг будах`}
          className="cursor-pointer outline-none focus-visible:[&>text]:fill-white"
          onClick={() => onPaintRow(r.rowLabel)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onPaintRow(r.rowLabel);
            }
          }}
        >
          <text
            x={px(b.minX - gutter / 2)}
            y={py(r.y_m) + fontSize / 3}
            textAnchor="middle"
            fontSize={Math.max(fontSize, 10)}
            className="fill-muted"
          >
            {r.rowLabel}
          </text>
        </g>
      ))}
      {seats.map((s) => {
        const isSel = selected === s.key;
        return (
          <g key={s.key}>
            <rect
              data-seat={s.key}
              x={px(s.x_m) - size / 2}
              y={py(s.y_m) - size / 2}
              width={size}
              height={size}
              rx={Math.min(size * 0.28, 5)}
              style={{ fill: KIND_FILL[s.kind] }}
              strokeWidth={isSel ? 2.5 : 1}
              strokeDasharray={s.kind === 'blocked' ? '2 2' : undefined}
              className={`cursor-pointer ${isSel ? 'stroke-action' : s.kind === 'blocked' ? 'stroke-seat' : 'stroke-hairline'}`}
            >
              <title>{`${s.rowLabel}${s.number}`}</title>
            </rect>
            {s.changed && (
              <circle
                cx={px(s.x_m) + size / 2}
                cy={py(s.y_m) - size / 2}
                r={Math.max(size * 0.14, 2.5)}
                className="fill-warning"
                pointerEvents="none"
              />
            )}
            {size >= 16 && (
              <text
                x={px(s.x_m)}
                y={py(s.y_m) + fontSize / 3}
                textAnchor="middle"
                fontSize={fontSize}
                className={s.kind === 'blocked' ? 'fill-muted' : 'fill-ink'}
                pointerEvents="none"
              >
                {s.kind === 'blocked' ? '×' : s.number}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
