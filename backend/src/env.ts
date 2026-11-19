import { z } from 'zod';

// Empty strings (as in .env.example) count as "unset".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const noSlash = (v: string) => v.replace(/\/+$/, '');

/** `1` / `true` switch a flag on; anything else (including unset) leaves it off. */
const flag = z.preprocess((v) => v === '1' || v === 'true', z.boolean());

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Interface to bind. Unset: loopback in production (the reverse proxy is the only way in, so
    // `x-forwarded-for` cannot be forged by direct clients); otherwise Node's default (all interfaces).
    HOST: optional(z.string()),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    DATABASE_URL: z.string().min(1),
    // Database TLS: off | require (encrypted, server identity NOT checked) | verify (checked against
    // DATABASE_CA_FILE, or the system store without it). A verifying sslmode in the URL counts as verify.
    // Default: require in production, off otherwise.
    DATABASE_SSL: optional(z.enum(['off', 'require', 'verify'])),
    DATABASE_CA_FILE: optional(z.string()),
    TEST_DATABASE_URL: optional(z.string()),
    JWT_SECRET: z.string().min(8),
    QR_SECRET: z.string().min(8),
    LINK_SECRET: z.string().min(8),
    API_PUBLIC_URL: z.string().default('http://localhost:8080').transform(noSlash),
    WEB_PUBLIC_URL: z.string().default('http://localhost:3000').transform(noSlash),
    // Shared with the web BFF: requests carrying it in `x-oc-bff-secret` may name the real
    // client in `x-oc-client-ip`, which the per-IP rate limits then use.
    BFF_SECRET: optional(z.string()),
    // Reverse-proxy hops in front of the API for direct app traffic (`trust proxy`).
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    MESSAGES_PROVIDER: z.enum(['dev', 'wesend']).default('dev'),
    WESEND_API_KEY: optional(z.string()),
    WESEND_FROM_NAME: z.string().default('Open Cinema'),
    WESEND_REPLY_TO: optional(z.string()),
    STORAGE_PROVIDER: z.enum(['local', 'r2']).default('local'),
    // Cloudflare R2 bucket, only for STORAGE_PROVIDER=r2.
    R2_ACCOUNT_ID: optional(z.string().regex(/^[0-9a-f]{32}$/, 'is the 32-character account ID')),
    R2_BUCKET: optional(z.string()),
    R2_ACCESS_KEY_ID: optional(z.string()),
    R2_SECRET_ACCESS_KEY: optional(z.string()),
    R2_PUBLIC_URL: optional(z.url()),
    // TMDB API read access token (v4), only for `movies:update`. Free at themoviedb.org.
    TMDB_READ_TOKEN: optional(z.string()),
    // Country whose cinema releases `movies:update` imports (ISO 3166-1, e.g. US, GB, KR).
    TMDB_REGION: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default('US'),
    PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
    // Production refuses the mock provider (anyone can mark an order paid) unless this is set.
    ALLOW_MOCK_PAYMENTS: flag.default(false),
    // Product name used in customer-facing text such as the invoice description.
    APP_NAME: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().default('Open Cinema'),
    ),
    WALLET_PASS_TYPE_ID: optional(z.string()),
    WALLET_TEAM_ID: optional(z.string()),
    WALLET_ORG_NAME: z.string().default('Open Cinema'),
    WALLET_SIGNER_CERT_PATH: optional(z.string()),
    WALLET_SIGNER_KEY_PATH: optional(z.string()),
    WALLET_SIGNER_KEY_PASSPHRASE: optional(z.string()),
    WALLET_WWDR_PATH: optional(z.string()),
    SEED_ADMIN_EMAIL: z.string().default('admin@example.com'),
    SEED_ADMIN_PASSWORD: z.string().min(8).default('change-me-admin'),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production') {
      for (const key of ['JWT_SECRET', 'QR_SECRET', 'LINK_SECRET'] as const) {
        if (e[key].length < 32) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'must be at least 32 characters in production',
          });
        }
      }
      if (e.BFF_SECRET === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['BFF_SECRET'],
          message: 'is required in production (the same value as the admin web app)',
        });
      } else if (e.BFF_SECRET.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: ['BFF_SECRET'],
          message: 'must be at least 32 characters in production',
        });
      }
      const secrets = [e.JWT_SECRET, e.QR_SECRET, e.LINK_SECRET];
      if (e.BFF_SECRET !== undefined) secrets.push(e.BFF_SECRET);
      if (new Set(secrets).size !== secrets.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_SECRET'],
          message:
            'JWT_SECRET, QR_SECRET, LINK_SECRET and BFF_SECRET must all differ in production',
        });
      }
      if (e.PAYMENT_PROVIDER === 'mock' && !e.ALLOW_MOCK_PAYMENTS) {
        ctx.addIssue({
          code: 'custom',
          path: ['ALLOW_MOCK_PAYMENTS'],
          message:
            'PAYMENT_PROVIDER=mock lets any customer mark an order paid; set ALLOW_MOCK_PAYMENTS=1 to run a demo in production',
        });
      }
    }
  })
  .transform((e) => ({
    ...e,
    // Whether the operator chose it; a choice weaker than the URL's sslmode is a startup error.
    DATABASE_SSL_SET: e.DATABASE_SSL !== undefined,
    DATABASE_SSL:
      e.DATABASE_SSL ?? (e.NODE_ENV === 'production' ? ('require' as const) : ('off' as const)),
    HOST: e.HOST ?? (e.NODE_ENV === 'production' ? '127.0.0.1' : undefined),
  }));

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export const env: Env = parseEnv();
