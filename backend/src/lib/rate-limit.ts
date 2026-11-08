import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../env';

const digest = (v: string) => createHash('sha256').update(v).digest();

/**
 * The caller's address. A request proving it comes from the web BFF (shared secret, constant-time
 * compare) carries the end user's address in `x-oc-client-ip`, used only when it is a real IP;
 * everything else is the socket address.
 */
function resolveClient(req: Request, secret: string | undefined): { ip: string; trusted: boolean } {
  const given = req.headers['x-oc-bff-secret'];
  const forwarded = req.headers['x-oc-client-ip'];
  if (
    secret &&
    typeof given === 'string' &&
    typeof forwarded === 'string' &&
    timingSafeEqual(digest(given), digest(secret))
  ) {
    const ip = forwarded.trim();
    if (isIP(ip)) return { ip, trusted: true };
  }
  return { ip: req.ip ?? 'unknown', trusted: false };
}

export const clientIp = (req: Request, secret: string | undefined = env.BFF_SECRET): string =>
  resolveClient(req, secret).ip;

/** Per-IP limiter key: IPv6 addresses are masked to their /56 so one subnet is one bucket. */
export function clientKey(req: Request, secret: string | undefined = env.BFF_SECRET): string {
  const { ip, trusted } = resolveClient(req, secret);
  return trusted ? `bff:${ipKeyGenerator(ip)}` : ipKeyGenerator(ip);
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
    refresh: limiter(15 * 60 * 1000, 120),
    ticketLink: limiter(15 * 60 * 1000, 60),
    // Generous: a busy door scans a few tickets a second. Keyed by staff, since a cinema shares one IP.
    scan: limiter(60_000, 120, (req) => req.user?.id ?? 'anonymous'),
  };
}
export type Limiters = ReturnType<typeof createLimiters>;
