import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { ADMIN_URL, DATABASE_NAME, DEMO_DIR, MAIL_DIR, REPO, serverEnv, WORK } from './env';

/**
 * Runs before the API starts (see playwright.config.ts): a fresh e2e
 * database, migrated and seeded with the synthetic tenants, empty mail and
 * file folders, and the public synthetic demo data set to upload.
 */
const env = serverEnv();

function run(command: string, args: string[], cwd = REPO) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
try {
  await admin.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DATABASE_NAME}`);
} finally {
  await admin.end();
}

for (const dir of [MAIL_DIR, join(WORK, 'documents'), join(WORK, 'auth'), DEMO_DIR]) rmSync(dir, { recursive: true, force: true });
mkdirSync(MAIL_DIR, { recursive: true });

run('pnpm', ['--filter', '@pactlab/db', 'generate']);
run('pnpm', ['--filter', '@pactlab/db', 'migrate:deploy']);
run('pnpm', ['--filter', '@pactlab/db', 'seed']);
run('python3', [join(REPO, 'scripts/demo-data/generate.py'), DEMO_DIR]);
