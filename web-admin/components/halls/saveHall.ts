import { call } from '@/lib/client-api';
import type { AdminHallDetail, HallGenParams, SeatKind } from '@/lib/shared';
import { seatKey } from './useHallDraft';

export type HallSave = {
  hall: AdminHallDetail | null;
  branchId: string;
  name: string;
  screenW: number;
  screenH: number;
  gen: HallGenParams;
  /** The generator values differ from the stored layout: seats are rebuilt (painting is lost). */
  regenerate: boolean;
  pending: Map<string, SeatKind>;
};

/**
 * Saves a hall in the order the API needs: create or patch the hall, rebuild the seats only when
 * the layout really changed, then apply the painted kinds to whichever seats now exist.
 */
export async function saveHall(a: HallSave): Promise<AdminHallDetail> {
  let detail: AdminHallDetail;
  if (!a.hall) {
    detail = await call<AdminHallDetail>('POST', '/admin/halls', {
      branchId: a.branchId,
      name: a.name,
      screen_width_m: a.screenW,
      screen_height_m: a.screenH,
      gen: a.gen,
    });
  } else {
    detail = a.hall;
    const meta =
      a.name !== a.hall.name ||
      a.screenW !== a.hall.screen_width_m ||
      a.screenH !== a.hall.screen_height_m;
    if (meta) {
      detail = await call<AdminHallDetail>('PATCH', `/admin/halls/${a.hall.id}`, {
        name: a.name,
        screen_width_m: a.screenW,
        screen_height_m: a.screenH,
      });
    }
    if (a.regenerate) {
      detail = await call<AdminHallDetail>('PUT', `/admin/halls/${a.hall.id}/regenerate`, {
        gen: a.gen,
      });
    }
  }
  const current = new Map(detail.seats.map((s) => [seatKey(s.rowLabel, s.number), s]));
  const changes = [...a.pending]
    .map(([key, kind]) => ({ seat: current.get(key), kind }))
    .filter((c) => c.seat && c.seat.kind !== c.kind)
    .map((c) => ({ seatId: (c.seat as { id: string }).id, kind: c.kind }));
  if (changes.length) {
    detail = await call<AdminHallDetail>('PATCH', `/admin/halls/${detail.id}/seats`, { changes });
  }
  return detail;
}
