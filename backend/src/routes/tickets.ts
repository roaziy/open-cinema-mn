import type { PublicTickets } from '@open-cinema/shared';
import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { bookings, tickets } from '../db/schema';
import { env } from '../env';
import { forbidden, notFound } from '../lib/errors';
import { validate } from '../lib/http';
import type { Limiters } from '../lib/rate-limit';
import { signPassUrl, verifyLink, verifyPassSig } from '../lib/sign';
import { requireAuth } from '../middleware/auth';
import { bookingView } from '../services/bookings';
import { myTickets, ticketViews } from '../services/tickets';
import { buildPass, WalletUnavailableError, walletConfig } from '../wallet/pass';

const UUID = z.string().uuid();
const ScopeQuery = z.object({ scope: z.enum(['upcoming', 'past']).default('upcoming') });
const PassQuery = z.object({ exp: z.coerce.number(), sig: z.string().min(1) });

export function createTicketsRouter(deps: AppDeps, limiters: Limiters): Router {
  const { db, clock } = deps;
  const r = Router();
  const auth = requireAuth(deps);

  r.get('/me/tickets', auth, validate(ScopeQuery, 'query'), async (req, res) => {
    const user = req.user as NonNullable<typeof req.user>;
    const { scope } = res.locals.query as z.infer<typeof ScopeQuery>;
    res.json(await myTickets(db, user.id, scope, clock()));
  });

  r.get('/tickets/:id', auth, async (req, res) => {
    const user = req.user as NonNullable<typeof req.user>;
    const id = String(req.params.id);
    if (!UUID.safeParse(id).success) throw notFound();
    // Someone else's ticket looks exactly like a missing one.
    const [view] = await ticketViews(
      db,
      sql`${eq(tickets.id, id)} and ${eq(bookings.userId, user.id)}`,
      clock(),
    );
    if (!view) throw notFound();
    res.json(view);
  });

  // Public: the signed link in the booking email is the only credential.
  r.get('/t/:linkToken', limiters.ticketLink, async (req, res) => {
    const bookingId = verifyLink(String(req.params.linkToken));
    if (!bookingId || !UUID.safeParse(bookingId).success) throw notFound();
    const view = await bookingView(db, bookingId, clock());
    const body: PublicTickets = {
      booking: {
        orderNo: view.orderNo,
        status: view.status,
        total: view.total,
        showtime: view.showtime,
      },
      tickets: await ticketViews(db, eq(tickets.bookingId, bookingId), clock()),
    };
    res.json(body);
  });

  // A fresh short-lived pass URL for one ticket of the link's booking, minted when the guest taps
  // "Add to Wallet". The page never holds a pass URL, so a cached or forwarded page cannot leak one.
  r.get('/t/:linkToken/pass/:ticketId', limiters.ticketLink, async (req, res) => {
    const bookingId = verifyLink(String(req.params.linkToken));
    const ticketId = String(req.params.ticketId);
    if (!bookingId || !UUID.safeParse(bookingId).success || !UUID.safeParse(ticketId).success) {
      throw notFound();
    }
    res.set('Cache-Control', 'no-store');
    if (!walletConfig()) {
      res.status(503).json({ error: 'wallet_not_configured' });
      return;
    }
    const [view] = await ticketViews(
      db,
      sql`${eq(tickets.id, ticketId)} and ${eq(tickets.bookingId, bookingId)}`,
      clock(),
    );
    if (view?.status !== 'valid') throw notFound();
    res.json({ url: `${env.API_PUBLIC_URL}${signPassUrl(ticketId, clock())}` });
  });

  // Authorised by a short-lived signature in the URL, so the Wallet app can fetch it unauthenticated.
  r.get('/tickets/:id/pass', validate(PassQuery, 'query'), async (req, res) => {
    const id = String(req.params.id);
    const { exp, sig } = res.locals.query as z.infer<typeof PassQuery>;
    if (!verifyPassSig(id, exp, sig, clock())) throw forbidden('invalid_or_expired_link');
    const cfg = walletConfig();
    if (!cfg) {
      res.status(503).json({ error: 'wallet_not_configured' });
      return;
    }
    const [view] = await ticketViews(db, eq(tickets.id, id), clock());
    if (view?.status !== 'valid') throw notFound();
    try {
      const pkpass = await buildPass(cfg, view);
      res
        .type('application/vnd.apple.pkpass')
        .set('Content-Disposition', `attachment; filename="ticket-${view.orderNo}.pkpass"`)
        .send(pkpass);
    } catch (err) {
      if (!(err instanceof WalletUnavailableError)) throw err;
      res.status(503).json({ error: 'wallet_not_configured' });
    }
  });

  return r;
}
