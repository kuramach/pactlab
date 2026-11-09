/**
 * The price book's Stripe price ids for this environment (T-087), as the schema owner:
 *   scripts/ops-task.sh <env> src/ops/billing-plans.ts list
 *   scripts/ops-task.sh <env> src/ops/billing-plans.ts set <PLAN_KEY> <price_...>
 * Create the prices in the Stripe dashboard first (test mode on stage, live on live), with the
 * amounts from ADR 0025. Pactlab never invents a price; Stripe charges what its price says.
 */
import { applyDatabaseUrls } from '@pactlab/config';
import pg from 'pg';

applyDatabaseUrls();
const [command, key, priceId] = process.argv.slice(2);
const url = process.env['DATABASE_MIGRATION_URL'];
if (!url) {
  process.stderr.write('DATABASE_MIGRATION_URL is required (run as the schema owner)\n');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url, options: '-c TimeZone=UTC' });
await client.connect();
try {
  if (command === 'list') {
    const { rows } = await client.query<{ key: string; amount: string; currency: string; interval: string | null; stripe_price_id: string | null; self_serve: boolean }>(
      'SELECT key, amount::text, currency, "interval", stripe_price_id, self_serve FROM app_billing_plans()',
    );
    for (const row of rows) process.stdout.write(`${row.key.padEnd(16)} ${row.currency} ${row.amount}${row.interval ? `/${row.interval}` : ''}  ${row.self_serve ? 'self-serve' : 'on request'}  ${row.stripe_price_id ?? '(no Stripe price yet)'}\n`);
  } else if (command === 'set' && key && priceId && /^price_[A-Za-z0-9]+$/.test(priceId)) {
    const { rows } = await client.query<{ ok: boolean }>('SELECT app_billing_set_price(NULL, $1, $2) AS ok', [key, priceId]);
    process.stdout.write(rows[0]?.ok ? `${key} now charges with ${priceId}\n` : `No plan ${key}\n`);
    if (!rows[0]?.ok) process.exitCode = 1;
  } else {
    process.stderr.write('Usage: billing-plans.ts list | set <PLAN_KEY> <price_...>\n');
    process.exitCode = 2;
  }
} finally {
  await client.end();
}
