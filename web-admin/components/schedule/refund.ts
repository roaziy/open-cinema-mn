import type { SeatMap } from '@open-cinema/shared';

/**
 * What cancelling a showing refunds, worked out from the live seat map before the admin
 * confirms: every sold seat is a ticket, and a booking paid the premium price for premium seats
 * and the standard price for the rest (the same rule the booking service charges by).
 */
export function refundPreview(map: Pick<SeatMap, 'seats' | 'showtime'>): {
  tickets: number;
  amount: number;
} {
  let tickets = 0;
  let amount = 0;
  for (const s of map.seats) {
    if (s.state !== 'sold') continue;
    tickets++;
    amount += s.kind === 'premium' ? map.showtime.pricePremium : map.showtime.priceStandard;
  }
  return { tickets, amount };
}
