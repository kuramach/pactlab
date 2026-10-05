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

export const baseEnvSchema = z.object({
  APP_ENV: z.enum(appEnvironments),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const apiEnvSchema = baseEnvSchema.extend({
  API_PORT: port.default(4000),
  APP_WEB_ORIGIN: z.url(),
  DATABASE_URL: postgresUrl,
  AUTH0_DOMAIN: nonEmpty,
  AUTH0_AUDIENCE: nonEmpty,
  /** Local-only directory for uploaded document originals. */
  DOCUMENT_STORE_DIR: nonEmpty.optional(),
});
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

/** Web server-only settings (Auth0 Regular Web Application). Never exposed to the browser. */
export const webServerEnvSchema = z.object({
  AUTH0_DOMAIN: nonEmpty,
  AUTH0_CLIENT_ID: nonEmpty,
  AUTH0_CLIENT_SECRET: nonEmpty,
  // Session-cookie encryption key; 32 bytes hex-encoded (`openssl rand -hex 32`).
  AUTH0_SECRET: nonEmpty.min(64, 'must be at least 32 bytes, hex-encoded'),
  APP_BASE_URL: z.url(),
  AUTH0_AUDIENCE: nonEmpty,
});
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
