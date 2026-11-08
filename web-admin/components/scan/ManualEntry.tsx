'use client';

import { ScanByOrder } from '@open-cinema/shared';
import { useEffect, useRef, useState } from 'react';

const FIELD =
  'focus-ring h-14 rounded-panel border border-hairline bg-surface px-4 text-[20px] uppercase text-ink placeholder:text-muted';

const LOOKALIKES: Record<string, string> = {
  А: 'A',
  В: 'B',
  С: 'C',
  Е: 'E',
  Н: 'H',
  К: 'K',
  М: 'M',
  О: 'O',
  Р: 'P',
  Т: 'T',
  Х: 'X',
  У: 'Y',
};

/**
 * Upper-case Latin for a seat or check code. A Mongolian keyboard types look-alike Cyrillic
 * letters (А В С Е Н К М О Р Т Х У) that no code contains, so they are mapped to their Latin twins.
 */
export function toLatinCode(v: string): string {
  return [...v.toUpperCase()].map((c) => LOOKALIKES[c] ?? c).join('');
}

/** Digits of a typed or pasted order number: "OC-10029", "oc 10029" and "10029" all give 10029. */
export function orderDigits(v: string): string {
  return v.replace(/^\s*oc[-\s]*/i, '').replace(/\D/g, '');
}

/**
 * For a dirty lens or a cracked screen: the order number, seat and 4-character code printed on
 * the paper ticket and shown in the app take the place of the QR. The code is what keeps a
 * guessed order number from admitting anyone.
 */
export function ManualEntry({
  onSubmit,
  onClose,
  hint,
}: {
  onSubmit: (input: { orderNo: string; seat: string; checkCode: string }) => void;
  onClose: () => void;
  hint?: string | null;
}) {
  const [digits, setDigits] = useState('');
  const [seat, setSeat] = useState('');
  const [code, setCode] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const parsed = ScanByOrder.pick({ orderNo: true, seat: true, checkCode: true }).safeParse({
    orderNo: `OC-${digits}`,
    seat: seat.replace(/\s/g, ''),
    checkCode: code.replace(/\s/g, ''),
  });
  return (
    <form
      className="animate-rise absolute inset-x-0 bottom-0 z-30 flex flex-col gap-4 rounded-t-rail border-t border-hairline bg-raised px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.success) onSubmit(parsed.data);
      }}
    >
      <h2 className="text-[20px] font-semibold text-ink">Гараар оруулах</h2>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="manual-order" className="text-[14px] text-body">
          Захиалгын дугаар
        </label>
        <div className="flex">
          <span className="flex h-14 items-center rounded-l-panel border border-r-0 border-hairline bg-fill px-4 text-[20px] font-semibold text-ink">
            OC-
          </span>
          <input
            id="manual-order"
            ref={ref}
            value={digits}
            onChange={(e) => setDigits(orderDigits(e.target.value))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="10029"
            className={`${FIELD} min-w-0 flex-1 rounded-l-none`}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="manual-seat" className="text-[14px] text-body">
            Суудал
          </label>
          <input
            id="manual-seat"
            value={seat}
            onChange={(e) => setSeat(toLatinCode(e.target.value))}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={6}
            placeholder="F3"
            className={`${FIELD} min-w-0`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="manual-code" className="text-[14px] text-body">
            Баталгаажуулах код
          </label>
          <input
            id="manual-code"
            value={code}
            onChange={(e) => setCode(toLatinCode(e.target.value))}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={4}
            placeholder="K7Q2"
            className={`${FIELD} min-w-0 font-mono tracking-[0.12em]`}
          />
        </div>
      </div>
      {hint && (
        <p role="status" className="text-[15px] text-body">
          {hint}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="focus-ring h-14 rounded-panel bg-fill px-6 text-[17px] font-semibold text-ink"
        >
          Болих
        </button>
        <button
          type="submit"
          disabled={!parsed.success}
          className="focus-ring h-14 flex-1 rounded-panel bg-action text-[17px] font-semibold text-white disabled:opacity-50"
        >
          Шалгах
        </button>
      </div>
    </form>
  );
}
