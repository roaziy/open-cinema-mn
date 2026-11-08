import 'server-only';
import {
  AdminDashboardSchema,
  AdminHallDetailSchema,
  AdminHallSchema,
  AdminMovieSchema,
  AdminReportSchema,
  AdminShowtimeListSchema,
  AdminStaffSchema,
  BranchSchema,
} from '@open-cinema/shared';
import { notFound, unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { ApiError, apiGet } from './api';

const q = (params: Record<string, string | undefined>): string => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : '';
};

/**
 * Runs a loader. API redirects (expired session) keep propagating; a 404 becomes the 404 page;
 * anything else resolves to `null` so the page can show a retryable error instead of crashing.
 */
export async function safely<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiError && (err.status === 404 || err.code === 'validation_failed')) {
      notFound();
    }
    return null;
  }
}

export const getDashboard = (branchId?: string) =>
  apiGet(`/admin/dashboard${q({ branchId })}`, AdminDashboardSchema);

export const getBranches = () => apiGet('/admin/branches', z.array(BranchSchema));

export const getHalls = (branchId?: string) =>
  apiGet(`/admin/halls${q({ branchId })}`, z.array(AdminHallSchema));

export const getHall = (id: string) => apiGet(`/admin/halls/${id}`, AdminHallDetailSchema);

export const getMovies = () => apiGet('/admin/movies', z.array(AdminMovieSchema));

export const getMovie = (id: string) => apiGet(`/admin/movies/${id}`, AdminMovieSchema);

export const getShowtimes = (p: { from: string; to: string; branchId?: string }) =>
  apiGet(`/admin/showtimes${q(p)}`, AdminShowtimeListSchema);

export const getStaff = () => apiGet('/admin/staff', z.array(AdminStaffSchema));

export const getReport = (p: { from: string; to: string; branchId?: string }) =>
  apiGet(`/admin/reports${q(p)}`, AdminReportSchema);
