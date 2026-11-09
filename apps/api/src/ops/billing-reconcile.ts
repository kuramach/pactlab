/**
 * Re-mirror every subscription from Stripe (T-087): the nightly reconciliation, also safe to run
 * any time. Stripe is the source of truth; this corrects anything a missed webhook left behind.
 *   scripts/ops-task.sh <env> src/ops/billing-reconcile.ts
 */
import { apiEnvSchema, applyDatabaseUrls, loadConfig } from '@pactlab/config';
import { StripeBillingProvider } from '@pactlab/connectors';
import { billing, createPrismaClient } from '@pactlab/db';
import pg from 'pg';

applyDatabaseUrls();
const config = loadConfig(apiEnvSchema);
if (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET) {
  process.stdout.write('Stripe is not configured here; nothing to reconcile.\n');
  process.exit(0);
}
const ownerUrl = process.env['DATABASE_MIGRATION_URL'];
if (!ownerUrl) {
  process.stderr.write('DATABASE_MIGRATION_URL is required (the account list is operator-only)\n');
  process.exit(1);
}
const provider = new StripeBillingProvider(config.STRIPE_SECRET_KEY, config.STRIPE_WEBHOOK_SECRET);
const owner = new pg.Client({ connectionString: ownerUrl, options: '-c TimeZone=UTC' });
const prisma = createPrismaClient({ connectionString: config.DATABASE_URL });
await owner.connect();
try {
  const { rows } = await owner.query<{ organization_id: string; subscription_id: string }>(
    'SELECT organization_id::text, subscription_id FROM app_billing_admin_accounts(NULL) WHERE subscription_id IS NOT NULL',
  );
  const plans = await billing.plans(prisma);
  let synced = 0;
  for (const row of rows) {
    const snapshot = await provider.subscription(row.subscription_id).catch(() => null);
    if (!snapshot) continue;
    const planKey = plans.find((plan) => plan.stripePriceId === snapshot.priceId)?.key ?? null;
    if (await billing.setSubscription(prisma, { organizationId: row.organization_id, customerId: snapshot.customerId || null, subscriptionId: row.subscription_id, planKey, status: snapshot.status, periodStart: snapshot.periodStart, periodEnd: snapshot.periodEnd, newPeriod: snapshot.status === 'ACTIVE' })) synced += 1;
  }
  process.stdout.write(`Reconciled ${synced} of ${rows.length} subscriptions from Stripe.\n`);
} finally {
  await owner.end();
  await prisma.$disconnect();
}
