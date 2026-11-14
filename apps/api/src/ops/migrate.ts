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
  // Created with its restrictions once. Later runs only refresh login and password: on RDS the owner is not a
  // superuser and may not even restate SUPERUSER/BYPASSRLS. The API refuses to start if they ever drift
  // (assertRuntimeRoleIsolation), so the restrictions stay checked on every start.
  await client.query(
    exists
      ? `ALTER ROLE ${runtimeUser} WITH LOGIN PASSWORD ${password}`
      : `CREATE ROLE ${runtimeUser} LOGIN PASSWORD ${password} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`,
  );
  await client.query(`GRANT pactlab_app TO ${runtimeUser}`);
  process.stdout.write(`migrate: runtime role ${exists ? 'updated' : 'created'}\n`);
} finally {
  await client.end();
}

const dbPackage = fileURLToPath(new URL('../../../../packages/db', import.meta.url));

// A migration that failed is recorded as failed, and Prisma then refuses every later deploy (P3009).
// Each migration file runs as one transaction, so a failed one left nothing behind. For the ones named
// here, whose failure is understood and fixed in the file, the record is cleared so the fixed file runs:
// 20261204000000_investment_committee failed on live (2026-11-14), its backfill stopped by the
// report-version immutability trigger. Any other failed migration still stops the deploy for a person.
const RETRY_AFTER_FIX = new Set(['20261204000000_investment_committee', '20261205000000_letters_of_intent', '20261206000000_brand_kits']);
const history = new pg.Client({ connectionString: ownerUrl });
await history.connect();
let retry: string[] = [];
try {
  const table = await history.query(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`);
  if ((table.rows[0] as { present: boolean }).present) {
    const rows = await history.query(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`);
    retry = rows.rows.map((row: { migration_name: string }) => row.migration_name).filter((name) => RETRY_AFTER_FIX.has(name));
  }
} finally {
  await history.end();
}
// Prisma's own binary, not `pnpm exec`: pnpm would check and reinstall dependencies first.
for (const name of retry) {
  process.stdout.write(`migrate: clearing the failed record of ${name} (rolled back; the file is fixed)\n`);
  execFileSync('./node_modules/.bin/prisma', ['migrate', 'resolve', '--rolled-back', name], { cwd: dbPackage, stdio: 'inherit', env: process.env });
}
execFileSync('./node_modules/.bin/prisma', ['migrate', 'deploy'], { cwd: dbPackage, stdio: 'inherit', env: process.env });
process.stdout.write('migrate: done\n');
