import { z } from 'zod';

export const appEnvironments = ['local', 'test', 'dev', 'qa', 'stage', 'production'] as const;
export type AppEnvironment = (typeof appEnvironments)[number];

const nonEmpty = z.string().trim().min(1);

const postgresUrl = nonEmpty.refine(
  (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
  'must be a postgres:// or postgresql:// URL',
);

const redisUrl = nonEmpty.refine(
  (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
  'must be a redis:// or rediss:// URL',
);

const port = z.coerce.number().int().min(1).max(65535);

/**
 * Auth0 is optional per deployment (organizations may use email one-time
 * codes instead), but never half-configured: either every listed variable
 * is set or none is. Missing ones are named; values are never echoed.
 */
function allOrNone<T extends Record<string, unknown>>(keys: readonly (keyof T & string)[]) {
  return (value: T, context: z.RefinementCtx) => {
    const present = keys.filter((key) => value[key] !== undefined);
    if (present.length === 0 || present.length === keys.length) return;
    for (const key of keys) {
      if (value[key] === undefined) {
        context.addIssue({ code: 'custom', path: [key], message: `required together with ${present.join(', ')}` });
      }
    }
  };
}

/** True when the deployment has Auth0 configured. */
export function auth0Configured(env: { AUTH0_DOMAIN?: string | undefined }): boolean {
  return env.AUTH0_DOMAIN !== undefined;
}

export const baseEnvSchema = z.object({
  APP_ENV: z.enum(appEnvironments),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const apiEnvSchema = baseEnvSchema.extend({
  API_PORT: port.default(4000),
  APP_WEB_ORIGIN: z.url(),
  DATABASE_URL: postgresUrl,
  AUTH0_DOMAIN: nonEmpty.optional(),
  AUTH0_AUDIENCE: nonEmpty.optional(),
  /** Local-only directory for uploaded document originals. */
  DOCUMENT_STORE_DIR: nonEmpty.optional(),
  /** Signs email-code session tokens and keys code hashes; at least 32 characters. */
  AUTH_TOKEN_SECRET: nonEmpty.min(32, 'must be at least 32 characters'),
  /** Local-only directory where sign-in emails are written instead of sent. */
  LOCAL_MAIL_DIR: nonEmpty.optional(),
  /** New self-serve organizations wait for `pnpm org:approve` (default) or are active at once. */
  SIGNUP_REQUIRES_APPROVAL: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  /** Who is emailed about new sign-ups. Unset: run `pnpm org:pending` to see them. */
  OPERATOR_EMAIL: z.email().optional(),
  /** Local-only encrypted store for provider credentials (directory and 32-byte base64 key). */
  LOCAL_SECRETS_DIR: nonEmpty.optional(),
  LOCAL_SECRETS_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be 32 bytes, base64-encoded')
    .optional(),
  /** Pactlab's read-only GitHub App (optional as a group). The key file is PKCS#8 PEM. */
  GITHUB_APP_ID: z.string().regex(/^\d+$/, 'numeric app id').optional(),
  GITHUB_APP_SLUG: z.string().regex(/^[a-z0-9-]+$/, 'app slug from its public URL').optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: nonEmpty.optional(),
})
  .superRefine(allOrNone(['AUTH0_DOMAIN', 'AUTH0_AUDIENCE']))
  .superRefine(allOrNone(['LOCAL_SECRETS_DIR', 'LOCAL_SECRETS_KEY']))
  .superRefine(allOrNone(['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY_PATH']));
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const workerEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const scannerEnvSchema = baseEnvSchema.extend({
  REDIS_URL: redisUrl,
});
export type ScannerEnv = z.infer<typeof scannerEnvSchema>;

/** Public web settings only. Never put server secrets in this schema. */
export const webPublicEnvSchema = z.object({
  NEXT_PUBLIC_APP_ENV: z.enum(appEnvironments),
  NEXT_PUBLIC_API_ORIGIN: z.url(),
});
export type WebPublicEnv = z.infer<typeof webPublicEnvSchema>;

/**
 * Web server-only settings. Auth0 (Regular Web Application) is optional as a
 * group; without it only email-code sign-in is offered. Never exposed to the browser.
 */
export const webServerEnvSchema = z
  .object({
    AUTH0_DOMAIN: nonEmpty.optional(),
    AUTH0_CLIENT_ID: nonEmpty.optional(),
    AUTH0_CLIENT_SECRET: nonEmpty.optional(),
    // Session-cookie encryption key; 32 bytes hex-encoded (`openssl rand -hex 32`).
    AUTH0_SECRET: nonEmpty.min(64, 'must be at least 32 bytes, hex-encoded').optional(),
    APP_BASE_URL: z.url(),
    AUTH0_AUDIENCE: nonEmpty.optional(),
  })
  .superRefine(
    allOrNone(['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'AUTH0_SECRET', 'AUTH0_AUDIENCE']),
  );
export type WebServerEnv = z.infer<typeof webServerEnvSchema>;

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    // Only variable names and messages — never values, which may be secrets.
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Validate configuration at startup and fail closed. Unknown variables are
 * ignored; missing or malformed required ones throw before the app serves traffic.
 */
export function loadConfig<TSchema extends z.ZodType>(
  schema: TSchema,
  source: Record<string, string | undefined> = process.env,
): z.infer<TSchema> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
