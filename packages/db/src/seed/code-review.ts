import { createGitHubEvidenceSource, GitHubFixtureAdapter, readAllCommits, REPOSITORY_HEAD_EVIDENCE_TYPE } from '@pactlab/connectors';
import {
  type DealId,
  type FindingActor,
  type OrganizationId,
  type TenantContext,
  type UserId,
} from '@pactlab/domain';
import type { PrismaClient } from '../client';
import { recordCodeSignalFindings } from '../code-signals';
import type { SyncRunOutcome } from '../sync';
import { seedSync } from './seed-sync';
import { withTenant } from '../tenant';

/** GitHub fixture repository connected to the TroubledCo deal. */
export const SEED_GITHUB_CONNECTION = {
  id: '01900000-0000-7000-8000-0000000e0102',
  repository: 'troubledco/core',
  displayName: 'TroubledCo core repository (fixture)',
} as const;

/** The heuristic scan that drafts code findings; never reviews them. */
const SEED_SCAN_ACTOR: FindingActor = { kind: 'SYSTEM', component: 'seed:code-signals' };

export interface CodeReviewSeedReport {
  /** Null when the repository could not be read (partial-permission fixture). */
  sync: SyncRunOutcome | null;
  failed: string | null;
  findingsCreated: number;
  findingsExisting: number;
}

/**
 * Pull a fixture repository head (TroubledCo by default) through the real
 * sync engine, then record the ghost-commit and key-person signals as DRAFT findings citing
 * that evidence and the exact head commit. Idempotent by fingerprint.
 * Nothing is submitted, priced or accepted — those are human steps.
 */
export async function seedCodeReview(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    dealId: string;
    leadUserId: string;
    syncRunId: string;
    connectionId?: string;
    repository?: string;
  },
): Promise<CodeReviewSeedReport> {
  const connectionId = input.connectionId ?? SEED_GITHUB_CONNECTION.id;
  const adapter = new GitHubFixtureAdapter({ repository: input.repository ?? SEED_GITHUB_CONNECTION.repository });
  const scope = {
    organizationId: input.organizationId,
    dealId: input.dealId,
    connectionId,
    credentialRef: null,
  };
  const { sync, failed } = await seedSync(
    prisma,
    { organizationId: input.organizationId, dealId: input.dealId, requestedBy: input.leadUserId, syncRunId: input.syncRunId },
    createGitHubEvidenceSource(adapter, scope),
  );
  if (!sync) return { sync, failed, findingsCreated: 0, findingsExisting: 0 };

  const tenant: TenantContext = {
    organizationId: input.organizationId as OrganizationId,
    userId: input.leadUserId as UserId,
    organizationRole: 'ORG_ADMIN',
    dealIds: [input.dealId as DealId],
  };
  const head = await adapter.head(scope);
  const recorded = await recordCodeSignalFindings(prisma, tenant, {
    dealId: input.dealId,
    connectionId,
    head,
    commits: await readAllCommits(adapter, scope),
    identityMap: await adapter.identityMap(scope),
    actor: SEED_SCAN_ACTOR,
    requestId: 'seed',
  });
  if (recorded.created + recorded.existing === 0 && !(await hasHeadEvidence(prisma, tenant, input.dealId, connectionId, head))) throw new Error('Seed repository evidence missing');
  const findingsCreated = recorded.created;
  const findingsExisting = recorded.existing;
  return { sync, failed, findingsCreated, findingsExisting };
}

async function hasHeadEvidence(prisma: PrismaClient, tenant: TenantContext, dealId: string, connectionId: string, head: { repository: string; headSha: string }) {
  const row = await withTenant(prisma, tenant, (tx) =>
    tx.evidenceItem.findFirst({ where: { dealId, connectionId, evidenceType: REPOSITORY_HEAD_EVIDENCE_TYPE, sourceRecordId: `${head.repository}@${head.headSha}` }, select: { id: true } }),
  );
  return row !== null;
}
