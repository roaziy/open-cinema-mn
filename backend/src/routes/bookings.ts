import { BookingCreateBody } from '@open-cinema/shared';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { bookings, payments } from '../db/schema';
import { env } from '../env';
import { conflict, notFound } from '../lib/errors';
import { validate } from '../lib/http';
import { TimeoutError } from '../lib/timeout';
import { requireAuth } from '../middleware/auth';
import { MockPaymentProvider } from '../payments/mock';
import { bookingView, confirmBooking, createBooking } from '../services/bookings';

const UUID = z.string().uuid();

export function createBookingsRouter(deps: AppDeps): Router {
  const { db, clock } = deps;
  const r = Router();
  const auth = requireAuth(deps);

  const ownBookingId = async (raw: string, userId: string): Promise<string> => {
    if (!UUID.safeParse(raw).success) throw notFound();
    const [b] = await db.select().from(bookings).where(eq(bookings.id, raw)).limit(1);
    // Someone else's booking looks exactly like a missing one.
    if (!b || b.userId !== userId) throw notFound();
    return b.id;
  };

  r.post('/bookings', auth, validate(BookingCreateBody), async (req, res) => {
    const user = req.user as NonNullable<typeof req.user>;
    const id = await createBooking(db, deps, {
      userId: user.id,
      isGuest: user.role === 'guest',
      body: req.body as BookingCreateBody,
    });
    res.json(await bookingView(db, id, clock(), user.id));
  });

  // The app polls this; a pending booking is checked against its invoice on every call.
  r.get('/bookings/:id', auth, async (req, res) => {
    const user = req.user as NonNullable<typeof req.user>;
    const id = await ownBookingId(String(req.params.id), user.id);
    try {
      await confirmBooking(db, id, deps);
    } catch (err) {
      // A provider that does not answer leaves the booking pending; the sweeper settles it later.
      if (!(err instanceof TimeoutError)) throw err;
      console.error('payment check timed out', err.message);
    }
    res.json(await bookingView(db, id, clock(), user.id));
  });

  if (env.PAYMENT_PROVIDER === 'mock') {
    r.post('/bookings/:id/mock-pay', auth, async (req, res) => {
      const user = req.user as NonNullable<typeof req.user>;
      const id = await ownBookingId(String(req.params.id), user.id);
      if (!(deps.payments instanceof MockPaymentProvider)) throw notFound();
      const [b] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
      if (b?.status !== 'pending') throw conflict('booking_not_pending');
      const [p] = await db.select().from(payments).where(eq(payments.bookingId, id)).limit(1);
      if (!p) throw conflict('invoice_missing');
      await deps.payments.markPaid(p.invoiceId);
      await confirmBooking(db, id, deps);
      res.json(await bookingView(db, id, clock(), user.id));
    });
  }

  // Stub: the real QPay callback will verify the provider and call confirmBooking.
  r.post('/payments/callback/:provider', (_req, res) => {
    res.status(204).end();
  });

  return r;
}
