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
// Each seed with its package's own tsx, not through pnpm (which would check and reinstall dependencies first).
const root = fileURLToPath(new URL('../../../..', import.meta.url));
for (const [dir, script] of [
  ['packages/db', 'src/seed/cli.ts'],
  ['apps/api', 'src/demo-seed/cli.ts'],
] as const) {
  execFileSync('./node_modules/.bin/tsx', [script], { cwd: `${root}/${dir}`, stdio: 'inherit', env: process.env });
}
