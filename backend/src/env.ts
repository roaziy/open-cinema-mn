import { z } from 'zod';

// Empty strings (as in .env.example) count as "unset".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const noSlash = (v: string) => v.replace(/\/+$/, '');

const DEFAULT_ADMIN_PASSWORD = 'change-me-admin';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Interface to bind. Unset: loopback in production (the reverse proxy is the only way in, so
    // `x-forwarded-for` cannot be forged by direct clients); otherwise Node's default (all interfaces).
    HOST: optional(z.string()),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().min(1),
    TEST_DATABASE_URL: optional(z.string()),
    JWT_SECRET: z.string().min(8),
    QR_SECRET: z.string().min(8),
    LINK_SECRET: z.string().min(8),
    API_PUBLIC_URL: z.string().default('http://localhost:4000').transform(noSlash),
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
    STORAGE_PROVIDER: z.enum(['local', 'supabase']).default('local'),
    SUPABASE_URL: optional(z.string()),
    SUPABASE_SERVICE_ROLE_KEY: optional(z.string()),
    SUPABASE_BUCKET: optional(z.string()),
    PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
    WALLET_PASS_TYPE_ID: optional(z.string()),
    WALLET_TEAM_ID: optional(z.string()),
    WALLET_ORG_NAME: z.string().default('Open Cinema'),
    WALLET_SIGNER_CERT_PATH: optional(z.string()),
    WALLET_SIGNER_KEY_PATH: optional(z.string()),
    WALLET_SIGNER_KEY_PASSPHRASE: optional(z.string()),
    WALLET_WWDR_PATH: optional(z.string()),
    SEED_ADMIN_EMAIL: z.string().default('admin@example.com'),
    SEED_ADMIN_PASSWORD: z.string().min(8).default(DEFAULT_ADMIN_PASSWORD),
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
      if (e.BFF_SECRET !== undefined && e.BFF_SECRET.length < 32) {
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
      if (e.SEED_ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
        ctx.addIssue({
          code: 'custom',
          path: ['SEED_ADMIN_PASSWORD'],
          message: 'must not be the default in production',
        });
      }
    }
  })
  .transform((e) => ({
    ...e,
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
