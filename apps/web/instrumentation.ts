import { publicEnv, serverEnv } from './lib/env';

/** Next.js startup hook: fail closed on missing or malformed configuration. */
export function register(): void {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  publicEnv();
  serverEnv();
}
