import {
  BranchSchema,
  type BranchShowtimes,
  BranchShowtimesSchema,
  MovieDetailSchema,
  MovieSummarySchema,
} from '@open-cinema/shared';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { api } from './api';

export const catalogKeys = {
  branches: ['branches'] as const,
  movies: (status: 'now' | 'soon') => ['movies', status] as const,
  movie: (id: string) => ['movie', id] as const,
  showtimes: (id: string, date: string) => ['showtimes', id, date] as const,
};

export function useBranches() {
  return useQuery({
    queryKey: catalogKeys.branches,
    queryFn: async () => BranchSchema.array().parse(await api('/branches')),
    staleTime: 5 * 60_000,
  });
}

export function useMovies(status: 'now' | 'soon') {
  return useQuery({
    queryKey: catalogKeys.movies(status),
    queryFn: async () => MovieSummarySchema.array().parse(await api(`/movies?status=${status}`)),
  });
}

export function useMovie(id: string) {
  return useQuery({
    queryKey: catalogKeys.movie(id),
    queryFn: async () => MovieDetailSchema.parse(await api(`/movies/${id}`)),
  });
}

async function fetchShowtimes(id: string, date: string): Promise<BranchShowtimes[]> {
  return BranchShowtimesSchema.array().parse(await api(`/movies/${id}/showtimes?date=${date}`));
}

export function useShowtimes(id: string, date: string) {
  return useQuery({
    queryKey: catalogKeys.showtimes(id, date),
    queryFn: () => fetchShowtimes(id, date),
    placeholderData: keepPreviousData,
  });
}

/**
 * Cheapest standard price among slots that still have seats over the given days
 * (null while loading, on failure, or when nothing is bookable). Shares the showtimes cache.
 */
export function useFromPrice(id: string, days: string[], enabled: boolean): number | null {
  const results = useQueries({
    queries: days.map((date) => ({
      queryKey: catalogKeys.showtimes(id, date),
      queryFn: () => fetchShowtimes(id, date),
      enabled,
    })),
  });
  const prices = results.flatMap((r) =>
    (r.data ?? []).flatMap((b) =>
      b.showtimes.filter((s) => s.seatsLeft > 0).map((s) => s.priceStandard),
    ),
  );
  return prices.length > 0 ? Math.min(...prices) : null;
}
