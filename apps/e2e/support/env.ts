import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * One environment for the whole browser run: its own database, ports, mail
 * and file folders, so a run never touches the developer's `pnpm dev` data.
 * Defaults match infra/local/docker-compose.yml; CI sets E2E_DATABASE_*.
 */
export const REPO = resolve(import.meta.dirname, '../../..');
export const WORK = resolve(import.meta.dirname, '../.data');
export const MAIL_DIR = join(WORK, 'mail');
export const AUTH_DIR = join(WORK, 'auth');
export const DEMO_DIR = join(WORK, 'demo-data');

export const API_PORT = Number(process.env['E2E_API_PORT'] ?? 4400);
export const WEB_PORT = Number(process.env['E2E_WEB_PORT'] ?? 3400);
export const API_ORIGIN = `http://localhost:${API_PORT}`;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const DATABASE_NAME = 'pactlab_e2e';

const withDatabase = (url: string) => {
  const parsed = new URL(url);
  parsed.pathname = `/${DATABASE_NAME}`;
  return parsed.toString();
};

export const MIGRATION_URL = withDatabase(
  process.env['E2E_DATABASE_MIGRATION_URL'] ?? 'postgresql://pactlab_owner:pactlab_owner_local@localhost:5432/pactlab',
);
/** The cluster's maintenance database, used only to drop and create the e2e database. */
export const ADMIN_URL = (() => {
  const parsed = new URL(MIGRATION_URL);
  parsed.pathname = '/postgres';
  return parsed.toString();
})();

/** A per-run token secret, kept in the work folder so servers and setup agree. */
function tokenSecret(): string {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, 'token-secret');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  return readFileSync(file, 'utf8').trim();
}

/** Environment for the API, web app, migrations, seed and ops commands. */
export function serverEnv(): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    APP_ENV: 'local',
    LOG_LEVEL: 'warn',
    APP_WEB_ORIGIN: WEB_ORIGIN,
    APP_BASE_URL: WEB_ORIGIN,
    API_PORT: String(API_PORT),
    DATABASE_URL: withDatabase(process.env['E2E_DATABASE_URL'] ?? 'postgresql://pactlab_api:pactlab_api_local@localhost:5432/pactlab'),
    DATABASE_MIGRATION_URL: MIGRATION_URL,
    // Redis database 1: e2e jobs never reach a developer's `pnpm dev` worker (database 0).
    REDIS_URL: process.env['E2E_REDIS_URL'] ?? 'redis://localhost:6379/1',
    AUTH_TOKEN_SECRET: tokenSecret(),
    LOCAL_MAIL_DIR: MAIL_DIR,
    DOCUMENT_STORE_DIR: join(WORK, 'documents'),
    // AI stays off: browser tests never call a model.
    AI_PROVIDER: 'none',
    NEXT_PUBLIC_APP_ENV: 'local',
    NEXT_PUBLIC_API_ORIGIN: API_ORIGIN,
    NEXT_TELEMETRY_DISABLED: '1',
  };
}
