import { loadConfig, webPublicEnvSchema, type WebPublicEnv } from '@pactlab/config';

/** Public settings only, validated once at server start. */
export function publicEnv(): WebPublicEnv {
  return loadConfig(webPublicEnvSchema, {
    NEXT_PUBLIC_APP_ENV: process.env['NEXT_PUBLIC_APP_ENV'],
    NEXT_PUBLIC_API_ORIGIN: process.env['NEXT_PUBLIC_API_ORIGIN'],
  });
}
