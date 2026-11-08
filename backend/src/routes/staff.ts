import { ScanBody } from '@open-cinema/shared';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { notFound } from '../lib/errors';
import { validate } from '../lib/http';
import { requireAuth, requireRole } from '../middleware/auth';
import { recentScans, scanTicket, todayShowtimes, undoScan } from '../services/scan';

const UUID = z.string().uuid();
const RecentQuery = z.object({ deviceId: UUID });
const TodayQuery = z.object({ branchId: UUID.optional() });

export function createStaffRouter(deps: AppDeps): Router {
  const { db, clock } = deps;
  const r = Router();
  const staff = [requireAuth(deps), requireRole('staff', 'admin')];
  // Generous: a busy door scans a few tickets a second at peak. Keyed by staff, not IP, because
  // a whole cinema shares one address.
  const scanLimit = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? 'anonymous',
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate_limited' });
    },
  });
  const me = (req: { user?: AppUser }) => req.user as AppUser;

  r.post('/staff/scan', ...staff, scanLimit, validate(ScanBody), async (req, res) => {
    res.json(await scanTicket(db, me(req), req.body, clock()));
  });

  r.post('/staff/scan/:scanId/undo', ...staff, scanLimit, async (req, res) => {
    const scanId = String(req.params.scanId);
    if (!UUID.safeParse(scanId).success) throw notFound();
    res.json(await undoScan(db, me(req), scanId, clock()));
  });

  r.get('/staff/scans/recent', ...staff, validate(RecentQuery, 'query'), async (req, res) => {
    const { deviceId } = res.locals.query as z.infer<typeof RecentQuery>;
    res.json(await recentScans(db, me(req).id, deviceId));
  });

  r.get('/staff/today', ...staff, validate(TodayQuery, 'query'), async (req, res) => {
    const user = me(req);
    const { branchId } = res.locals.query as z.infer<typeof TodayQuery>;
    // Staff only ever see their own branch; a staff account without one sees nothing.
    if (user.role !== 'admin' && !user.branchId) {
      res.json([]);
      return;
    }
    res.json(
      await todayShowtimes(db, clock(), user.role === 'admin' ? (branchId ?? null) : user.branchId),
    );
  });

  return r;
}

type AppUser = NonNullable<import('express').Request['user']>;
