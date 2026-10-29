import { describe, expect, it } from 'vitest';
import { applyDatabaseUrls, databaseUrl, RDS_CA_BUNDLE_PATH } from './database-url';

describe('database URLs from secret fields', () => {
  it('encodes credentials and verifies TLS against the RDS bundle', () => {
    const url = new URL(databaseUrl({ host: 'db.internal', port: '5432', database: 'pactlab', user: 'pactlab_api', password: 'p@ss/w:rd?#' }));
    expect(url.hostname).toBe('db.internal');
    expect(decodeURIComponent(url.password)).toBe('p@ss/w:rd?#');
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
    expect(url.searchParams.get('sslrootcert')).toBe(RDS_CA_BUNDLE_PATH);
  });

  it('fills the runtime and migration URLs, and never overrides one already set', () => {
    const env: Record<string, string | undefined> = { DB_HOST: 'db.internal', DB_USER: 'pactlab_api', DB_PASSWORD: 'a', DB_OWNER_USER: 'pactlab_owner', DB_OWNER_PASSWORD: 'b' };
    expect(applyDatabaseUrls(env)).toEqual(['DATABASE_URL', 'DATABASE_MIGRATION_URL']);
    expect(env['DATABASE_URL']).toContain('pactlab_api:a@db.internal:5432/pactlab');
    expect(env['DATABASE_MIGRATION_URL']).toContain('pactlab_owner:b@');
    const local = { DATABASE_URL: 'postgresql://local', DB_HOST: 'db.internal', DB_USER: 'x', DB_PASSWORD: 'y' };
    expect(applyDatabaseUrls(local)).toEqual([]);
    expect(local.DATABASE_URL).toBe('postgresql://local');
    expect(applyDatabaseUrls({})).toEqual([]);
  });
});
