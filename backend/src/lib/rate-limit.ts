import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

const limiter = (
  windowMs: number,
  limit: number,
  keyGenerator?: (req: Request) => string,
): RequestHandler =>
  rateLimit({
    windowMs,
    limit,
    ...(keyGenerator && { keyGenerator }),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate_limited' });
    },
  });

/** Per-IP limiters. Created per app so each instance (and each test) has its own counters. */
export function createLimiters() {
  return {
    otp: limiter(15 * 60 * 1000, 20),
    guest: limiter(60 * 60 * 1000, 30),
    login: limiter(15 * 60 * 1000, 30),
    ticketLink: limiter(15 * 60 * 1000, 60),
    // Generous: a busy door scans a few tickets a second. Keyed by staff, since a cinema shares one IP.
    scan: limiter(60_000, 120, (req) => req.user?.id ?? 'anonymous'),
  };
}
export type Limiters = ReturnType<typeof createLimiters>;
