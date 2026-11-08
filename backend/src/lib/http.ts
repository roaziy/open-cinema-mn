import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { notFound } from './errors';

type Source = 'body' | 'query' | 'params';

/**
 * Validates `req[source]` with a zod schema. Errors surface as 400 `validation_failed`.
 * The parsed value replaces `req.body`, or lands in `res.locals[source]` for query/params
 * (Express 5 makes `req.query` a read-only getter).
 */
export function validate<S extends z.ZodType>(schema: S, source: Source = 'body'): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.parse(req[source]);
    if (source === 'body') req.body = parsed;
    else res.locals[source] = parsed;
    next();
  };
}

const UUID = z.string().uuid();

/** A route param that must be a UUID; anything else cannot exist, so it is a plain 404. */
export function uuidParam(req: Request, name = 'id'): string {
  const value = String(req.params[name]);
  if (!UUID.safeParse(value).success) throw notFound();
  return value;
}
