/**
 * `pnpm --filter @pactlab/api seed:deployed` — the one-off seed task for the
 * dev and qa environments (ADR 0019): the database seed, then the demo seed,
 * with the database URLs built from the task's secret fields. Synthetic data
 * only, so it refuses stage and production. Never prints credentials.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyDatabaseUrls } from '@pactlab/config';

const environment = process.env['APP_ENV'];
if (environment !== 'dev' && environment !== 'qa') {
  process.stderr.write('seed:deployed runs only in dev and qa: synthetic data never goes to stage or production.\n');
  process.exit(2);
}
applyDatabaseUrls();
const root = fileURLToPath(new URL('../../../..', import.meta.url));
for (const filter of ['@pactlab/db', '@pactlab/api']) {
  execFileSync('pnpm', ['--filter', filter, 'seed'], { cwd: root, stdio: 'inherit', env: process.env });
}
