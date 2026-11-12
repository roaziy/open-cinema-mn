import { useEffect, useRef, useState } from 'react';

/** Eases a number toward its target over `ms` (totals count up and down instead of jumping). */
export function useTween(target: number, ms = 260): number {
  const [value, setValue] = useState(target);
  const shown = useRef(target);

  useEffect(() => {
    const start = Date.now();
    const from = shown.current;
    if (from === target) return;
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / ms);
      const eased = 1 - (1 - p) ** 3;
      shown.current = Math.round(from + (target - from) * eased);
      setValue(shown.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return value;
}
