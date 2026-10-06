import {
  createJiraEvidenceSource,
  GITHUB_FIXTURE_VERSION,
  JIRA_FIXTURE_VERSION,
  JiraFixtureAdapter,
} from '@pactlab/connectors';
import { createCsvEvidenceSource, newId } from '@pactlab/domain';
import type { PrismaClient } from '../client';
import {
  loadSyntheticManifest,
  readSyntheticDataset,
  SYNTHETIC_COMPANIES,
  type SyntheticCompany,
} from '../fixtures';
import { executeSyncRun, type SyncRunOutcome } from '../sync';
import { SEED_GITHUB_CONNECTION, seedCodeReview, type CodeReviewSeedReport } from './code-review';
import { seedSync } from './seed-sync';

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

/**
 * A buyer organization that chose email one-time-code sign-in instead of
 * Auth0. Its lead signs in at /login with the address below; locally the
 * code is written to LOCAL_MAIL_DIR.
 */
export const SEED_EMAIL_CODE_TENANT = {
  organizationId: '01900000-0000-7000-8000-00000000c001',
  userId: '01900000-0000-7000-8000-00000000c002',
  dealId: '01900000-0000-7000-8000-00000000c003',
  slug: 'charlie-advisory',
  name: 'Charlie Advisory (synthetic)',
  email: 'lead@charlie.example',
  displayName: 'Charlie Deal Lead (synthetic)',
  dealName: 'Project Beacon',
  targetName: 'Beacon Software (synthetic)',
} as const;

/** A target-side contributor on the HealthyCo deal, to exercise the contributor boundary. */
export const SEED_CONTRIBUTOR = {
  userId: '01900000-0000-7000-8000-00000000a004',
  subject: 'auth0|synthetic-healthyco-contributor',
  displayName: 'HealthyCo Finance Contributor (synthetic)',
} as const;

/**
 * A second buyer-side reviewer on the TroubledCo deal: findings and
 * valuation submissions need a decision by someone other than the author.
 */
export const SEED_REVIEWER = {
  userId: '01900000-0000-7000-8000-00000000a005',
  subject: 'auth0|synthetic-alpha-reviewer',
  displayName: 'Alpha Reviewer (synthetic)',
} as const;

/**
 * Code and delivery sources per synthetic target: a GitHub fixture repository
 * and a Jira fixture site. SparseCo's Jira config names a project the
 * installation cannot read, to exercise partial permissions.
 */
export const SEED_TARGET_SOURCES: Readonly<
  Record<SyntheticCompany, { github: { connectionId: string; repository: string }; jira: { connectionId: string; site: string; projectKeys: string[] } }>
> = {
  HealthyCo: {
    github: { connectionId: '01900000-0000-7000-8000-0000000e0101', repository: 'healthyco/platform' },
    jira: { connectionId: '01900000-0000-7000-8000-0000000e0201', site: 'healthyco.atlassian.net', projectKeys: ['HC'] },
  },
  TroubledCo: {
    github: { connectionId: SEED_GITHUB_CONNECTION.id, repository: SEED_GITHUB_CONNECTION.repository },
    jira: { connectionId: '01900000-0000-7000-8000-0000000e0202', site: 'troubledco.atlassian.net', projectKeys: ['TC'] },
  },
  SparseCo: {
    github: { connectionId: '01900000-0000-7000-8000-0000000e0103', repository: 'sparseco/app' },
    jira: { connectionId: '01900000-0000-7000-8000-0000000e0203', site: 'sparseco.atlassian.net', projectKeys: ['SP', 'SPX'] },
  },
};

/**
 * Buyer organizations that each hold the three synthetic targets. Alpha uses
 * the manifest identities; Charlie (email-code sign-in) gets its own copies
 * with deterministically derived ids, so both sign-in paths see the same
 * evidence without any cross-organization sharing.
 */
function targetHolders() {
  return [
    { label: 'Alpha', organizationId: SEED_TENANTS[0].organizationId, leadUserId: SEED_TENANTS[0].userId, idFor: (id: string) => id, keyPrefix: '' },
    {
      label: 'Charlie',
      organizationId: SEED_EMAIL_CODE_TENANT.organizationId,
      leadUserId: SEED_EMAIL_CODE_TENANT.userId,
      idFor: (id: string) => id.replace('-8000-', '-8c00-'),
      keyPrefix: 'charlie:',
    },
  ] as const;
}

export interface SourceSeedReport {
  holder: string;
  company: string;
  provider: 'csv' | 'github' | 'jira';
  dealId: string;
  /** Null when the source failed; `failed` names the error class. */
  sync: SyncRunOutcome | null;
  failed: string | null;
}

export interface SeedReport {
  tenants: number;
  companies: { company: string; dealId: string; sync: SyncRunOutcome }[];
  codeReview: CodeReviewSeedReport;
  sources: SourceSeedReport[];
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

    const charlie = SEED_EMAIL_CODE_TENANT;
    await owner.query(
      `INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', now())
       ON CONFLICT (id) DO NOTHING`,
      [charlie.organizationId, charlie.name, charlie.slug],
    );
    await owner.query(
      `INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [charlie.userId, `pactlab|${charlie.userId}`, charlie.displayName, charlie.email],
    );
    await owner.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_ADMIN')
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [newId(), charlie.organizationId, charlie.userId],
    );
    await insertDeal(
      owner,
      charlie.organizationId,
      charlie.dealId,
      charlie.dealName,
      charlie.targetName,
      'PRIVATE_ACQUIRER',
      charlie.userId,
    );

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
      if (company === 'TroubledCo') {
        await owner.query(
          `INSERT INTO users (id, auth0_subject, display_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [SEED_REVIEWER.userId, SEED_REVIEWER.subject, SEED_REVIEWER.displayName],
        );
        await owner.query(
          `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER')
           ON CONFLICT (organization_id, user_id) DO NOTHING`,
          [newId(), alpha.organizationId, SEED_REVIEWER.userId],
        );
        await owner.query(
          `INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'REVIEWER')
           ON CONFLICT (organization_id, deal_id, user_id) DO NOTHING`,
          [newId(), alpha.organizationId, manifest.deal.id, SEED_REVIEWER.userId],
        );
      }
      if (company === 'HealthyCo') {
        await owner.query(
          `INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'TARGET_CONTRIBUTOR')
           ON CONFLICT (organization_id, deal_id, user_id) DO NOTHING`,
          [newId(), alpha.organizationId, manifest.deal.id, SEED_CONTRIBUTOR.userId],
        );
      }
    }

    // Every holder gets each target with billing CSVs, a GitHub repository and a Jira site.
    for (const holder of targetHolders()) {
      for (const company of SYNTHETIC_COMPANIES) {
        const manifest = await loadSyntheticManifest(company);
        const dealId = holder.idFor(manifest.deal.id);
        const sources = SEED_TARGET_SOURCES[company];
        await insertDeal(
          owner,
          holder.organizationId,
          dealId,
          manifest.deal.name,
          manifest.displayName,
          manifest.deal.transactionType,
          holder.leadUserId,
        );
        const connections: [string, string, string, unknown][] = [
          [holder.idFor(manifest.connection.id), 'csv', manifest.connection.displayName, { datasets: manifest.datasets.map((d) => d.dataset) }],
          [holder.idFor(sources.github.connectionId), 'github', `${sources.github.repository} (fixture)`, { repository: sources.github.repository }],
          [holder.idFor(sources.jira.connectionId), 'jira', `${sources.jira.site} Jira (fixture)`, { site: sources.jira.site, projectKeys: sources.jira.projectKeys }],
        ];
        for (const [id, provider, displayName, config] of connections) {
          await owner.query(
            `INSERT INTO connections (id, organization_id, deal_id, provider, display_name, mode, config, created_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'FIXTURE', $6::jsonb, $7, now()) ON CONFLICT (id) DO NOTHING`,
            [id, holder.organizationId, dealId, provider, displayName, JSON.stringify(config), holder.leadUserId],
          );
        }
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
      `seed:${company}:v1`,
      CSV_FIXTURE_CONNECTOR_VERSION,
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

  const troubled = await loadSyntheticManifest('TroubledCo');
  const codeReview = await seedCodeReview(prisma, {
    organizationId: alpha.organizationId,
    dealId: troubled.deal.id,
    leadUserId: alpha.userId,
    syncRunId: await stableSyncRun(
      owner,
      alpha.organizationId,
      troubled.deal.id,
      SEED_GITHUB_CONNECTION.id,
      'seed:TroubledCo:github:v1',
      GITHUB_FIXTURE_VERSION,
      alpha.userId,
    ),
  });

  const sources: SourceSeedReport[] = [];
  for (const holder of targetHolders()) {
    for (const company of SYNTHETIC_COMPANIES) {
      const manifest = await loadSyntheticManifest(company);
      const dealId = holder.idFor(manifest.deal.id);
      const target = SEED_TARGET_SOURCES[company];
      const job = (syncRunId: string) => ({
        organizationId: holder.organizationId,
        dealId,
        requestedBy: holder.leadUserId,
        syncRunId,
      });
      const run = (connectionId: string, kind: string, version: string) =>
        stableSyncRun(
          owner,
          holder.organizationId,
          dealId,
          holder.idFor(connectionId),
          kind === 'csv' && holder.keyPrefix === '' ? `seed:${company}:v1` : `seed:${holder.keyPrefix}${company}:${kind}:v1`,
          version,
          holder.leadUserId,
        );

      if (holder.keyPrefix !== '') {
        // Alpha's CSV evidence is synced above under its original keys.
        const csv = await seedSync(
          prisma,
          job(await run(manifest.connection.id, 'csv', CSV_FIXTURE_CONNECTOR_VERSION)),
          createCsvEvidenceSource({ provider: 'csv', version: CSV_FIXTURE_CONNECTOR_VERSION, datasets: manifest.datasets, load: readSyntheticDataset }),
        );
        sources.push({ holder: holder.label, company, provider: 'csv', dealId, ...csv });
      }

      // TroubledCo in Alpha already ran above (codeReview); this replays as a no-op.
      const github = await seedCodeReview(prisma, {
        organizationId: holder.organizationId,
        dealId,
        leadUserId: holder.leadUserId,
        connectionId: holder.idFor(target.github.connectionId),
        repository: target.github.repository,
        syncRunId: await run(target.github.connectionId, 'github', GITHUB_FIXTURE_VERSION),
      });
      sources.push({ holder: holder.label, company, provider: 'github', dealId, sync: github.sync, failed: github.failed });

      const jira = new JiraFixtureAdapter({ site: target.jira.site, projectKeys: target.jira.projectKeys });
      const jiraScope = {
        organizationId: holder.organizationId,
        dealId,
        connectionId: holder.idFor(target.jira.connectionId),
        credentialRef: null,
      };
      const jiraSync = await seedSync(
        prisma,
        job(await run(target.jira.connectionId, 'jira', JIRA_FIXTURE_VERSION)),
        createJiraEvidenceSource(jira, jiraScope, jira.unreadableProjects()),
      );
      sources.push({ holder: holder.label, company, provider: 'jira', dealId, ...jiraSync });
    }
  }
  return { tenants: SEED_TENANTS.length + 1, companies, codeReview, sources };
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

/** One sync run per seeded connection under a stable idempotency key; returns its id. */
async function stableSyncRun(
  owner: SqlExecutor,
  organizationId: string,
  dealId: string,
  connectionId: string,
  key: string,
  connectorVersion: string,
  requestedBy: string,
): Promise<string> {
  await owner.query(
    `INSERT INTO sync_runs (id, organization_id, deal_id, connection_id, connector_version, idempotency_key, requested_by, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'seed')
     ON CONFLICT (organization_id, deal_id, idempotency_key) DO NOTHING`,
    [
      newId(),
      organizationId,
      dealId,
      connectionId,
      connectorVersion,
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
