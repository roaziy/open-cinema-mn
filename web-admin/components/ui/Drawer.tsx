'use client';

import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Right-hand panel over a dimmed page. Esc closes, focus stays inside, focus returns on close. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  step,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Changes when the content swaps to another step: focus then moves into the new step. */
  step?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  // Opening, and every step change, puts focus where the new content starts: the control that
  // asks for it, else the title (a changed heading is announced).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `step` is the trigger, not a value read here
  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    const target =
      panel?.querySelector<HTMLElement>('[data-step-focus]') ??
      panel?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') ??
      panel?.querySelector<HTMLElement>('h2');
    target?.focus();
  }, [open, step]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Хаах"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="highlight relative flex h-full w-full max-w-[460px] flex-col border-l border-hairline bg-surface outline-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              tabIndex={-1}
              className="truncate text-lg font-semibold text-ink outline-none"
            >
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 truncate text-[13px] text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Хаах"
            className="focus-ring -mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-card text-muted transition-colors hover:bg-white/[0.06] hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-hairline bg-raised/60 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
