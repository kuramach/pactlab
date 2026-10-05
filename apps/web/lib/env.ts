import {
  loadConfig,
  webPublicEnvSchema,
  webServerEnvSchema,
  type WebPublicEnv,
  type WebServerEnv,
} from '@pactlab/config';

/** Public settings only, validated once at server start. */
export function publicEnv(): WebPublicEnv {
  return loadConfig(webPublicEnvSchema, {
    NEXT_PUBLIC_APP_ENV: process.env['NEXT_PUBLIC_APP_ENV'],
    NEXT_PUBLIC_API_ORIGIN: process.env['NEXT_PUBLIC_API_ORIGIN'],
  });
}

/** Server-only sign-in settings. Never import from client components. */
export function serverEnv(): WebServerEnv {
  return loadConfig(webServerEnvSchema, {
    AUTH0_DOMAIN: process.env['AUTH0_DOMAIN'],
    AUTH0_CLIENT_ID: process.env['AUTH0_CLIENT_ID'],
    AUTH0_CLIENT_SECRET: process.env['AUTH0_CLIENT_SECRET'],
    AUTH0_SECRET: process.env['AUTH0_SECRET'],
    APP_BASE_URL: process.env['APP_BASE_URL'],
    AUTH0_AUDIENCE: process.env['AUTH0_AUDIENCE'],
  });
}
