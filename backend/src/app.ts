import cors from 'cors';
import { sql } from 'drizzle-orm';
import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { type Db, db as defaultDb } from './db/client';
import { env } from './env';
import { AppError } from './lib/errors';
import { createLimiters } from './lib/rate-limit';
import { SeatHub } from './lib/seat-hub';
import { createMessages, type Messages } from './messages';
import { createPayments, type PaymentProvider } from './payments/provider';
import { createAuthRouter } from './routes/auth';
import { createBookingsRouter } from './routes/bookings';
import { createCatalogRouter } from './routes/catalog';
import { createHoldsRouter } from './routes/holds';
import { createTicketsRouter } from './routes/tickets';
import { createStorage, type StorageProvider, UPLOAD_DIR } from './storage';

export type AppDeps = {
  db: Db;
  messages: Messages;
  payments: PaymentProvider;
  storage: StorageProvider;
  clock: () => Date;
  seatHub: SeatHub;
};

export function createDeps(over: Partial<AppDeps> = {}): AppDeps {
  const db = over.db ?? defaultDb;
  const clock = over.clock ?? (() => new Date());
  const deps: AppDeps = {
    db,
    messages: over.messages ?? createMessages(),
    payments: over.payments ?? createPayments(db, clock),
    storage: over.storage ?? createStorage(),
    clock,
    seatHub: over.seatHub ?? new SeatHub(),
  };
  return deps;
}

export function createApp(over: Partial<AppDeps> = {}): Express {
  const deps = createDeps(over);

  const app = express();
  app.disable('x-powered-by');
  // Local uploads are loaded cross-origin by the web and mobile apps.
  app.use(
    '/media',
    helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }),
    express.static(UPLOAD_DIR, { index: false }),
  );
  app.use(helmet());
  const origins = env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '1mb' }));

  const v1 = express.Router();
  v1.get('/health', async (_req, res) => {
    try {
      await deps.db.execute(sql`select 1`);
      res.json({ ok: true, db: true });
    } catch {
      res.status(503).json({ ok: false, db: false });
    }
  });
  const limiters = createLimiters();
  v1.use(createAuthRouter(deps, limiters));
  v1.use(createCatalogRouter(deps));
  v1.use(createHoldsRouter(deps));
  v1.use(createBookingsRouter(deps));
  v1.use(createTicketsRouter(deps, limiters));
  app.use('/v1', v1);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const message = err.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    res.status(400).json({ error: 'validation_failed', message });
    return;
  }
  if (err instanceof AppError) {
    res
      .status(err.status)
      .json({ error: err.code, ...(err.message !== err.code && { message: err.message }) });
    return;
  }
  // body-parser errors carry a status and a type such as entity.parse.failed
  const status = (err as { status?: number }).status;
  const type = (err as { type?: string }).type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'payload_too_large' });
    return;
  }
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: 'bad_request' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
};
