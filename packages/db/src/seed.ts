/**
 * Idempotent local seed: two synthetic buyer tenants with stable identities,
 * so `pnpm dev` has data to show and isolation can be checked by hand.
 * Runs as the schema owner. HealthyCo / TroubledCo / SparseCo arrive in T-002.
 */
import pg from 'pg';

const url = process.env['DATABASE_MIGRATION_URL'];
if (!url) {
  process.stderr.write('DATABASE_MIGRATION_URL is required for seeding\n');
  process.exit(1);
}

const tenants = [
  {
    organizationId: '01900000-0000-7000-8000-00000000a001',
    userId: '01900000-0000-7000-8000-00000000a002',
    dealId: '01900000-0000-7000-8000-00000000a003',
    slug: 'alpha-capital',
    name: 'Alpha Capital (synthetic)',
    auth0OrganizationId: 'org_synthetic_alpha',
    subject: 'auth0|synthetic-alpha-lead',
    dealName: 'Project Lighthouse',
    targetName: 'Lighthouse Analytics (synthetic)',
    transactionType: 'PRIVATE_ACQUIRER',
  },
  {
    organizationId: '01900000-0000-7000-8000-00000000b001',
    userId: '01900000-0000-7000-8000-00000000b002',
    dealId: '01900000-0000-7000-8000-00000000b003',
    slug: 'bravo-partners',
    name: 'Bravo Partners (synthetic)',
    auth0OrganizationId: 'org_synthetic_bravo',
    subject: 'auth0|synthetic-bravo-lead',
    dealName: 'Project Keystone',
    targetName: 'Keystone Billing (synthetic)',
    transactionType: 'TAKE_PRIVATE',
  },
] as const;

const client = new pg.Client({ connectionString: url, options: '-c TimeZone=UTC' });
await client.connect();
try {
  await client.query('BEGIN');
  for (const t of tenants) {
    await client.query(
      `INSERT INTO organizations (id, name, slug, auth0_organization_id, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO NOTHING`,
      [t.organizationId, t.name, t.slug, t.auth0OrganizationId],
    );
    await client.query(
      `INSERT INTO users (id, auth0_subject, display_name) VALUES ($1, $2, 'Synthetic Deal Lead') ON CONFLICT (id) DO NOTHING`,
      [t.userId, t.subject],
    );
    await client.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES (uuidv7(), $1, $2, 'ORG_ADMIN')
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [t.organizationId, t.userId],
    );
    await client.query(
      `INSERT INTO deals (id, organization_id, name, target_name, transaction_type, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now()) ON CONFLICT (id) DO NOTHING`,
      [t.dealId, t.organizationId, t.dealName, t.targetName, t.transactionType, t.userId],
    );
    await client.query(
      `INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES (uuidv7(), $1, $2, $3, 'DEAL_LEAD')
       ON CONFLICT (organization_id, deal_id, user_id) DO NOTHING`,
      [t.organizationId, t.dealId, t.userId],
    );
  }
  await client.query('COMMIT');
  process.stdout.write(`Seeded ${tenants.length} synthetic tenants\n`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
