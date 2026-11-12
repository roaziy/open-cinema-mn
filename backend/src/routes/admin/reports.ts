import { Router } from 'express';
import type { z } from 'zod';
import type { AppDeps } from '../../app';
import { badRequest } from '../../lib/errors';
import { validate } from '../../lib/http';
import { buildDashboard, buildReport } from '../../services/reports';
import { AdminDashboardQuery, AdminReportQuery, ubDayRange } from '../../shared';

const MAX_REPORT_DAYS = 366;

export function createAdminReportsRouter({ db, clock }: AppDeps): Router {
  const r = Router();

  r.get('/reports', validate(AdminReportQuery, 'query'), async (_req, res) => {
    const q = res.locals.query as z.infer<typeof AdminReportQuery>;
    const days = (ubDayRange(q.to).end.getTime() - ubDayRange(q.from).start.getTime()) / 86_400_000;
    if (days > MAX_REPORT_DAYS) throw badRequest('range_too_long');
    res.json(await buildReport(db, q));
  });

  r.get('/dashboard', validate(AdminDashboardQuery, 'query'), async (_req, res) => {
    const { branchId } = res.locals.query as z.infer<typeof AdminDashboardQuery>;
    res.json(await buildDashboard(db, clock(), branchId));
  });

  return r;
}
