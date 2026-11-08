import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';

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

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Explicit async wrapper; Express 5 already forwards rejections, this keeps intent obvious. */
export const asyncRoute =
  (fn: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
