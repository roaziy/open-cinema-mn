'use client';

import type { SeatKind } from '@open-cinema/shared';
import { KIND_FILL, KIND_LABEL, KINDS } from './kinds';
import type { Tool } from './useHallDraft';

/** Pick what a click or drag does: look at a seat, or paint it with a kind. */
export function PaintToolbar({
  tool,
  setTool,
  counts,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  counts: Record<SeatKind, number>;
}) {
  return (
    <fieldset className="flex flex-wrap gap-1.5" aria-label="Багаж">
      <ToolButton active={tool === 'view'} onClick={() => setTool('view')} label="Харах" />
      {KINDS.map((k) => (
        <ToolButton
          key={k}
          active={tool === k}
          onClick={() => setTool(k)}
          label={KIND_LABEL[k]}
          swatch={KIND_FILL[k]}
          count={counts[k]}
        />
      ))}
    </fieldset>
  );
}

function ToolButton({
  active,
  onClick,
  label,
  swatch,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  swatch?: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`focus-ring inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors ${
        active
          ? 'border-action bg-action/15 text-ink'
          : 'border-hairline text-body hover:border-white/20'
      }`}
    >
      {swatch && (
        <span
          aria-hidden
          className="size-3 rounded-[4px] border border-white/15"
          style={{ background: swatch }}
        />
      )}
      {label}
      {count !== undefined && <span className="text-muted tabular-nums">{count}</span>}
    </button>
  );
}
