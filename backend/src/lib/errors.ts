/** An error that maps directly to a JSON response `{ error: code, message? }`. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
}

export const notFound = (code = 'not_found') => new AppError(404, code);
export const badRequest = (code: string, message?: string) => new AppError(400, code, message);
export const unauthorized = (code = 'unauthorized') => new AppError(401, code);
export const forbidden = (code = 'forbidden') => new AppError(403, code);
export const conflict = (code: string, message?: string) => new AppError(409, code, message);

/** True when a node-postgres / Drizzle error is a unique violation (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/** True for a foreign key violation (SQLSTATE 23503), e.g. deleting a row that is still referenced. */
export function isForeignKeyViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23503' || e?.cause?.code === '23503';
}
