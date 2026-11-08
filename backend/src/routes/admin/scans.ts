import { AdminScanQuery } from '@open-cinema/shared';
import { Router } from 'express';
import type { z } from 'zod';
import type { AppDeps } from '../../app';
import { validate } from '../../lib/http';
import { adminScans } from '../../services/scan';

export function createAdminScansRouter({ db }: AppDeps): Router {
  const r = Router();

  /** Scan history across branches, newest first. */
  r.get('/scans', validate(AdminScanQuery, 'query'), async (_req, res) => {
    res.json(await adminScans(db, res.locals.query as z.infer<typeof AdminScanQuery>));
  });

  return r;
}
