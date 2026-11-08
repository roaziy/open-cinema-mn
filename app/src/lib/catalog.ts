import {
  BranchSchema,
  type BranchShowtimes,
  BranchShowtimesSchema,
  MovieDetailSchema,
  MovieSummarySchema,
  ubDate,
} from '@open-cinema/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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

export function useShowtimes(id: string, date: string) {
  return useQuery({
    queryKey: catalogKeys.showtimes(id, date),
    queryFn: async (): Promise<BranchShowtimes[]> =>
      BranchShowtimesSchema.array().parse(await api(`/movies/${id}/showtimes?date=${date}`)),
    placeholderData: keepPreviousData,
  });
}

/** The next seven Ulaanbaatar calendar days, today first. */
export function nextUbDays(count = 7, now: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => ubDate(new Date(now.getTime() + i * 86_400_000)));
}
