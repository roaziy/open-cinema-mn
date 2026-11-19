import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { deltaPct } from '@/lib/format';

/** Change against the baseline in words: colour only supports the sign and the arrow. */
export function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (now === 0 && before === 0)
    return <span className="text-[13px] text-muted">Өчигдөр мөн адил 0</span>;
  const d = deltaPct(now, before);
  if (d === null) {
    return <span className="text-[13px] text-muted">Өчигдөр борлуулалт байгаагүй</span>;
  }
  const up = d > 0;
  const flat = d === 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-muted">
      <span
        className={`inline-flex items-center gap-0.5 font-medium ${
          flat ? 'text-muted' : up ? 'text-success' : 'text-danger'
        }`}
      >
        <Icon size={14} aria-hidden />
        {flat ? '0%' : `${up ? '+' : '−'}${Math.abs(d)}%`}
      </span>
      {label}
    </span>
  );
}
