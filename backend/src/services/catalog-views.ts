import type { Branch, MovieSummary, ShowtimeSlot } from '@open-cinema/shared';
import { sql } from 'drizzle-orm';
import {
  type branches,
  halls,
  type movies,
  seatHolds,
  seats,
  showtimes,
  tickets,
} from '../db/schema';

type MovieRow = typeof movies.$inferSelect;
type BranchRow = typeof branches.$inferSelect;

export const toSummary = (m: MovieRow): MovieSummary => ({
  id: m.id,
  title: m.title,
  posterUrl: m.posterUrl,
  backdropUrl: m.backdropUrl,
  tone: m.tone,
  ageRating: m.ageRating,
  durationMin: m.durationMin,
  genres: m.genres,
  // archived films are never returned by the public routes
  status: m.status === 'soon' ? 'soon' : 'now',
  releaseDate: m.releaseDate,
});

export const toBranch = (b: BranchRow): Branch => ({
  id: b.id,
  name: b.name,
  address: b.address,
  lat: b.lat,
  lng: b.lng,
});

export const SLOT_COLUMNS = {
  id: showtimes.id,
  startsAt: showtimes.startsAt,
  format: showtimes.format,
  priceStandard: showtimes.priceStandard,
  pricePremium: showtimes.pricePremium,
  hallName: halls.name,
  capacity: sql<number>`(select count(*)::int from ${seats} where ${seats.hallId} = ${halls.id} and ${seats.kind} <> 'blocked')`,
  sold: sql<number>`(select count(*)::int from ${tickets} where ${tickets.showtimeId} = ${showtimes.id} and ${tickets.status} = 'valid')`,
};

export function heldCount(now: Date) {
  return sql<number>`(select count(*)::int from ${seatHolds} where ${seatHolds.showtimeId} = ${showtimes.id} and ${seatHolds.expiresAt} > ${now.toISOString()}::timestamptz and not exists (select 1 from ${tickets} where ${tickets.showtimeId} = ${seatHolds.showtimeId} and ${tickets.seatId} = ${seatHolds.seatId} and ${tickets.status} = 'valid'))`;
}

export type SlotRow = {
  id: string;
  startsAt: Date;
  format: ShowtimeSlot['format'];
  priceStandard: number;
  pricePremium: number;
  hallName: string;
  capacity: number;
  sold: number;
  held: number;
};

export const toSlot = (r: SlotRow): ShowtimeSlot => ({
  id: r.id,
  startsAt: r.startsAt.toISOString(),
  format: r.format,
  priceStandard: r.priceStandard,
  pricePremium: r.pricePremium,
  seatsLeft: Math.max(0, r.capacity - r.sold - r.held),
  capacity: r.capacity,
  hallName: r.hallName,
});
