import { HoldCreateBody } from '@open-cinema/shared';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { notFound } from '../lib/errors';
import { validate } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { activeHolds, createHolds, releaseHold, SeatTakenError } from '../services/holds';

const UUID = z.string().uuid();

export function createHoldsRouter(deps: AppDeps): Router {
  const { db, clock, seatHub } = deps;
  const r = Router();
  const auth = requireAuth(deps);
  // Per user, not per IP: many customers share one mobile-carrier address.
  const holdLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? 'anonymous',
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate_limited' });
    },
  });

  r.post('/showtimes/:id/holds', auth, holdLimiter, validate(HoldCreateBody), async (req, res) => {
    const showtimeId = String(req.params.id);
    if (!UUID.safeParse(showtimeId).success) throw notFound();
    const { seatIds } = req.body as HoldCreateBody;
    try {
      const { holds, changes } = await createHolds(db, {
        showtimeId,
        seatIds,
        userId: req.user?.id ?? '',
        now: clock(),
      });
      seatHub.publish(showtimeId, changes);
      res.json({ holds });
    } catch (err) {
      if (err instanceof SeatTakenError) {
        res.status(409).json({ error: 'seat_taken', seatIds: err.seatIds });
        return;
      }
      throw err;
    }
  });

  r.get('/showtimes/:id/holds/mine', auth, async (req, res) => {
    const showtimeId = String(req.params.id);
    if (!UUID.safeParse(showtimeId).success) throw notFound();
    res.json(await activeHolds(db, { showtimeId, userId: req.user?.id ?? '', now: clock() }));
  });

  r.delete('/holds/:id', auth, async (req, res) => {
    const holdId = String(req.params.id);
    if (!UUID.safeParse(holdId).success) throw notFound();
    const freed = await releaseHold(db, { holdId, userId: req.user?.id ?? '' });
    if (!freed) throw notFound();
    seatHub.publish(freed.showtimeId, [{ seatId: freed.seatId, state: 'free' }]);
    res.status(204).end();
  });

  return r;
}
