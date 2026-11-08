import { z } from 'zod';

// Empty strings (as in .env.example) count as "unset".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const DEFAULT_ADMIN_PASSWORD = 'change-me-admin';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().min(1),
    TEST_DATABASE_URL: optional(z.string()),
    JWT_SECRET: z.string().min(8),
    QR_SECRET: z.string().min(8),
    LINK_SECRET: z.string().min(8),
    API_PUBLIC_URL: z.string().default('http://localhost:4000'),
    WEB_PUBLIC_URL: z.string().default('http://localhost:3000'),
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
      if (e.SEED_ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
        ctx.addIssue({
          code: 'custom',
          path: ['SEED_ADMIN_PASSWORD'],
          message: 'must not be the default in production',
        });
      }
    }
  });

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
