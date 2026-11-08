import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../env';

const digest = (v: string) => createHash('sha256').update(v).digest();

/**
 * Per-IP limiter key. A request proving it comes from the web BFF (shared secret, constant-time
 * compare) is keyed by the end user's address the BFF forwards; everything else by `req.ip`.
 */
export function clientKey(req: Request, secret: string | undefined = env.BFF_SECRET): string {
  const given = req.headers['x-oc-bff-secret'];
  const forwarded = req.headers['x-oc-client-ip'];
  if (
    secret &&
    typeof given === 'string' &&
    typeof forwarded === 'string' &&
    forwarded.trim() !== '' &&
    timingSafeEqual(digest(given), digest(secret))
  ) {
    return `bff:${forwarded.trim().slice(0, 64)}`;
  }
  return ipKeyGenerator(req.ip ?? 'unknown');
}

const limiter = (
  windowMs: number,
  limit: number,
  keyGenerator?: (req: Request) => string,
): RequestHandler =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator: keyGenerator ?? ((req) => clientKey(req)),
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
