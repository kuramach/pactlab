/**
 * Deployed tasks receive database credentials as separate secret fields
 * (ECS injects each field of the Secrets Manager secret on its own), never
 * as one committed URL. This builds the URLs the app and Prisma read:
 * TLS verified against the RDS certificate bundle baked into the image.
 * A URL that is already set always wins, so local `.env` files are untouched.
 */
export const RDS_CA_BUNDLE_PATH = '/etc/pactlab/rds-ca-bundle.pem';

type Env = Record<string, string | undefined>;

export function databaseUrl(parts: { host: string; port: string; database: string; user: string; password: string; caBundle?: string }): string {
  const url = new URL(`postgresql://${parts.host}:${parts.port}/${encodeURIComponent(parts.database)}`);
  url.username = encodeURIComponent(parts.user);
  url.password = encodeURIComponent(parts.password);
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', parts.caBundle ?? RDS_CA_BUNDLE_PATH);
  return url.toString();
}

/**
 * Fill DATABASE_URL (runtime role: DB_USER/DB_PASSWORD) and
 * DATABASE_MIGRATION_URL (schema owner: DB_OWNER_USER/DB_OWNER_PASSWORD) from
 * DB_HOST, DB_PORT and DB_NAME when they are not set. Returns the names it set.
 */
export function applyDatabaseUrls(env: Env = process.env): string[] {
  const { DB_HOST: host, DB_PORT: port = '5432', DB_NAME: database = 'pactlab' } = env;
  if (!host) return [];
  const set: string[] = [];
  if (!env['DATABASE_URL'] && env['DB_USER'] && env['DB_PASSWORD']) {
    env['DATABASE_URL'] = databaseUrl({ host, port, database, user: env['DB_USER'], password: env['DB_PASSWORD'] });
    set.push('DATABASE_URL');
  }
  if (!env['DATABASE_MIGRATION_URL'] && env['DB_OWNER_USER'] && env['DB_OWNER_PASSWORD']) {
    env['DATABASE_MIGRATION_URL'] = databaseUrl({ host, port, database, user: env['DB_OWNER_USER'], password: env['DB_OWNER_PASSWORD'] });
    set.push('DATABASE_MIGRATION_URL');
  }
  return set;
}
