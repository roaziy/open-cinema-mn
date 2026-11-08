/** Runs once when the server starts (not during the build). */
export function register(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.BFF_SECRET) {
    console.warn(
      'WARNING: BFF_SECRET is not set. The API will see every visitor as one address and refresh logouts can happen. Set the same BFF_SECRET here and on the API (deploy/README.md).',
    );
  }
}
