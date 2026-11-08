/** Where the Express API lives, as seen from this server (never exposed to browsers). */
export const API_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export const APP_NAME = process.env.APP_NAME ?? 'Open Cinema';

export const IS_PROD = process.env.NODE_ENV === 'production';
