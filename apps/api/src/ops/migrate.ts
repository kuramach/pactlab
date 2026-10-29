/**
 * `pnpm --filter @pactlab/api migrate:deployed` — the one-off migration task a
 * deploy runs before any service rolls out (ADR 0019). As the schema owner:
 * create the runtime roles if missing (the same roles and rights as
 * `infra/local/postgres-init/01-roles.sql`), set the runtime login's password
 * from its secret, then apply pending Prisma migrations. Exits non-zero on
 * any failure, which stops the deploy. Never prints credentials.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyDatabaseUrls } from '@pactlab/config';
import pg from 'pg';

applyDatabaseUrls();
const ownerUrl = process.env['DATABASE_MIGRATION_URL'];
const runtimeUser = process.env['DB_USER'] ?? 'pactlab_api';
const runtimePassword = process.env['DB_PASSWORD'];
if (!ownerUrl || !runtimePassword) {
  process.stderr.write('migrate: DB_HOST, DB_OWNER_USER, DB_OWNER_PASSWORD and DB_PASSWORD are required\n');
  process.exit(2);
}
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeUser)) {
  process.stderr.write('migrate: DB_USER must be a plain role name\n');
  process.exit(2);
}

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pactlab_app') THEN
      CREATE ROLE pactlab_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
  END $$;`);
  const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [runtimeUser])).rowCount === 1;
  const password = client.escapeLiteral(runtimePassword);
  await client.query(
    exists
      ? `ALTER ROLE ${runtimeUser} WITH LOGIN PASSWORD ${password} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`
      : `CREATE ROLE ${runtimeUser} LOGIN PASSWORD ${password} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`,
  );
  await client.query(`GRANT pactlab_app TO ${runtimeUser}`);
  process.stdout.write(`migrate: runtime role ${exists ? 'updated' : 'created'}\n`);
} finally {
  await client.end();
}

const dbPackage = fileURLToPath(new URL('../../../../packages/db', import.meta.url));
execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: dbPackage, stdio: 'inherit', env: process.env });
process.stdout.write('migrate: done\n');
