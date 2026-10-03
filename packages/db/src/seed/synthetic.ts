import { createCsvEvidenceSource, newId } from '@pactlab/domain';
import type { PrismaClient } from '../client';
import { loadSyntheticManifest, readSyntheticDataset, SYNTHETIC_COMPANIES } from '../fixtures';
import { executeSyncRun, type SyncRunOutcome } from '../sync';

export interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export const CSV_FIXTURE_CONNECTOR_VERSION = 'csv-fixture-1';

/** Stable synthetic buyer tenants. Alpha also hosts the three synthetic targets. */
export const SEED_TENANTS = [
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

/** A target-side contributor on the HealthyCo deal, to exercise the contributor boundary. */
export const SEED_CONTRIBUTOR = {
  userId: '01900000-0000-7000-8000-00000000a004',
  subject: 'auth0|synthetic-healthyco-contributor',
  displayName: 'HealthyCo Finance Contributor (synthetic)',
} as const;

export interface SeedReport {
  tenants: number;
  companies: { company: string; dealId: string; sync: SyncRunOutcome }[];
}

/**
 * Idempotent seed. Identities and memberships are inserted as the schema
 * owner with ON CONFLICT DO NOTHING; evidence goes through the real sync
 * engine under RLS with a stable idempotency key, so re-running is a no-op.
 */
export async function seedSynthetic(owner: SqlExecutor, prisma: PrismaClient): Promise<SeedReport> {
  const alpha = SEED_TENANTS[0];
  await owner.query('BEGIN');
  try {
    for (const t of SEED_TENANTS) {
      await owner.query(
        `INSERT INTO organizations (id, name, slug, auth0_organization_id, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO NOTHING`,
        [t.organizationId, t.name, t.slug, t.auth0OrganizationId],
      );
      await owner.query(
        `INSERT INTO users (id, auth0_subject, display_name) VALUES ($1, $2, 'Synthetic Deal Lead') ON CONFLICT (id) DO NOTHING`,
        [t.userId, t.subject],
      );
      await owner.query(
        `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_ADMIN')
         ON CONFLICT (organization_id, user_id) DO NOTHING`,
        [newId(), t.organizationId, t.userId],
      );
      await insertDeal(
        owner,
        t.organizationId,
        t.dealId,
        t.dealName,
        t.targetName,
        t.transactionType,
        t.userId,
      );
    }

    await owner.query(
      `INSERT INTO users (id, auth0_subject, display_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [SEED_CONTRIBUTOR.userId, SEED_CONTRIBUTOR.subject, SEED_CONTRIBUTOR.displayName],
    );
    await owner.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER')
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [newId(), alpha.organizationId, SEED_CONTRIBUTOR.userId],
    );

    for (const company of SYNTHETIC_COMPANIES) {
      const manifest = await loadSyntheticManifest(company);
      await insertDeal(
        owner,
        alpha.organizationId,
        manifest.deal.id,
        manifest.deal.name,
        manifest.displayName,
        manifest.deal.transactionType,
        alpha.userId,
      );
      await owner.query(
        `INSERT INTO connections (id, organization_id, deal_id, provider, display_name, mode, config, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'FIXTURE', $6::jsonb, $7, now()) ON CONFLICT (id) DO NOTHING`,
        [
          manifest.connection.id,
          alpha.organizationId,
          manifest.deal.id,
          manifest.connection.provider,
          manifest.connection.displayName,
          JSON.stringify({ datasets: manifest.datasets.map((dataset) => dataset.dataset) }),
          alpha.userId,
        ],
      );
      if (company === 'HealthyCo') {
        await owner.query(
          `INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'TARGET_CONTRIBUTOR')
           ON CONFLICT (organization_id, deal_id, user_id) DO NOTHING`,
          [newId(), alpha.organizationId, manifest.deal.id, SEED_CONTRIBUTOR.userId],
        );
      }
    }
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }

  const companies: SeedReport['companies'] = [];
  for (const company of SYNTHETIC_COMPANIES) {
    const manifest = await loadSyntheticManifest(company);
    const runId = await stableSyncRun(
      owner,
      alpha.organizationId,
      manifest.deal.id,
      manifest.connection.id,
      company,
      alpha.userId,
    );
    const source = createCsvEvidenceSource({
      provider: 'csv',
      version: CSV_FIXTURE_CONNECTOR_VERSION,
      datasets: manifest.datasets,
      load: readSyntheticDataset,
    });
    const sync = await executeSyncRun(
      prisma,
      {
        organizationId: alpha.organizationId,
        dealId: manifest.deal.id,
        requestedBy: alpha.userId,
        syncRunId: runId,
      },
      source,
    );
    companies.push({ company, dealId: manifest.deal.id, sync });
  }
  return { tenants: SEED_TENANTS.length, companies };
}

async function insertDeal(
  owner: SqlExecutor,
  organizationId: string,
  dealId: string,
  name: string,
  targetName: string,
  transactionType: string,
  leadUserId: string,
): Promise<void> {
  await owner.query(
    `INSERT INTO deals (id, organization_id, name, target_name, transaction_type, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now()) ON CONFLICT (id) DO NOTHING`,
    [dealId, organizationId, name, targetName, transactionType, leadUserId],
  );
  await owner.query(
    `INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'DEAL_LEAD')
     ON CONFLICT (organization_id, deal_id, user_id) DO NOTHING`,
    [newId(), organizationId, dealId, leadUserId],
  );
}

/** One sync run per company under a stable idempotency key; returns its id. */
async function stableSyncRun(
  owner: SqlExecutor,
  organizationId: string,
  dealId: string,
  connectionId: string,
  company: string,
  requestedBy: string,
): Promise<string> {
  const key = `seed:${company}:v1`;
  await owner.query(
    `INSERT INTO sync_runs (id, organization_id, deal_id, connection_id, connector_version, idempotency_key, requested_by, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'seed')
     ON CONFLICT (organization_id, deal_id, idempotency_key) DO NOTHING`,
    [
      newId(),
      organizationId,
      dealId,
      connectionId,
      CSV_FIXTURE_CONNECTOR_VERSION,
      key,
      requestedBy,
    ],
  );
  const result = (await owner.query(
    `SELECT id::text AS id FROM sync_runs WHERE organization_id = $1 AND deal_id = $2 AND idempotency_key = $3`,
    [organizationId, dealId, key],
  )) as { rows: { id: string }[] };
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Seed sync run missing');
  return id;
}
