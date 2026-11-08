import { Router } from 'express';
import type { AppDeps } from '../../app';
import { requireAuth, requireRole } from '../../middleware/auth';
import { createAdminBranchesRouter } from './branches';
import { createAdminHallsRouter } from './halls';
import { createAdminMoviesRouter } from './movies';
import { createAdminReportsRouter } from './reports';
import { createAdminShowtimesRouter } from './showtimes';
import { createAdminStaffRouter } from './staff';
import { createAdminUploadsRouter } from './uploads';

/** Everything under /v1/admin: authenticated admins only. */
export function createAdminRouter(deps: AppDeps): Router {
  const r = Router();
  r.use(requireAuth(deps), requireRole('admin'));
  r.use(createAdminBranchesRouter(deps));
  r.use(createAdminHallsRouter(deps));
  r.use(createAdminMoviesRouter(deps));
  r.use(createAdminShowtimesRouter(deps));
  r.use(createAdminStaffRouter(deps));
  r.use(createAdminReportsRouter(deps));
  r.use(createAdminUploadsRouter(deps));
  return r;
}
