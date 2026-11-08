import { describe, expect, it } from 'vitest';
import { refundPreview } from '../components/schedule/refund';

const seat = (kind: string, state: string) => ({ kind, state }) as never;

describe('refundPreview', () => {
  it('sums sold seats by kind and ignores held and free ones', () => {
    const r = refundPreview({
      showtime: { priceStandard: 15000, pricePremium: 22000 } as never,
      seats: [
        seat('standard', 'sold'),
        seat('standard', 'sold'),
        seat('premium', 'sold'),
        seat('wheelchair', 'sold'),
        seat('standard', 'held'),
        seat('premium', 'free'),
      ],
    });
    expect(r).toEqual({ tickets: 4, amount: 15000 * 3 + 22000 });
  });

  it('is zero for a showing nobody bought', () => {
    expect(
      refundPreview({
        showtime: { priceStandard: 15000, pricePremium: 22000 } as never,
        seats: [seat('standard', 'free')],
      }),
    ).toEqual({ tickets: 0, amount: 0 });
  });
});
