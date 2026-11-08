import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

const limiter = (windowMs: number, limit: number): RequestHandler =>
  rateLimit({
    windowMs,
    limit,
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
  };
}
export type Limiters = ReturnType<typeof createLimiters>;
