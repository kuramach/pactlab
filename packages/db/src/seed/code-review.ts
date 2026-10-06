import {
  createGitHubEvidenceSource,
  GitHubFixtureAdapter,
  readAllCommits,
  REPOSITORY_HEAD_EVIDENCE_TYPE,
} from '@pactlab/connectors';
import {
  analyseKeyPersonRisk,
  createDraft,
  detectGhostCommits,
  ghostCommitFinding,
  keyPersonFindings,
  newId,
  type DealId,
  type FindingActor,
  type OrganizationId,
  type TenantContext,
  type UserId,
} from '@pactlab/domain';
import { appendAuditEvent } from '../audit';
import type { PrismaClient } from '../client';
import { findings } from '../findings';
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
  const evidenceItem = await withTenant(prisma, tenant, (tx) =>
    tx.evidenceItem.findFirst({
      where: {
        dealId: input.dealId,
        connectionId,
        evidenceType: REPOSITORY_HEAD_EVIDENCE_TYPE,
        sourceRecordId: `${head.repository}@${head.headSha}`,
      },
      select: { id: true },
    }),
  );
  if (!evidenceItem) throw new Error('Seed repository evidence missing');

  const commits = await readAllCommits(adapter, scope);
  const source = { evidenceItemId: evidenceItem.id, headCommitSha: head.headSha };
  const ghost = ghostCommitFinding(detectGhostCommits(commits, await adapter.identityMap(scope)), source);
  const proposals = [...(ghost ? [ghost] : []), ...keyPersonFindings(analyseKeyPersonRisk(commits), source)];

  let findingsCreated = 0;
  let findingsExisting = 0;
  for (const proposal of proposals) {
    const created = await withTenant(prisma, tenant, async (tx) => {
      if (await findings.findByFingerprint(tx, input.dealId, proposal.fingerprint)) return false;
      const finding = createDraft(proposal, SEED_SCAN_ACTOR, {
        id: newId(),
        organizationId: input.organizationId,
        dealId: input.dealId,
        now: new Date().toISOString(),
      });
      await findings.insert(tx, finding);
      await appendAuditEvent(tx, {
        organizationId: input.organizationId,
        dealId: input.dealId,
        actorUserId: null,
        action: 'finding.drafted',
        targetType: 'finding',
        targetId: finding.id,
        outcome: 'SUCCEEDED',
        requestId: 'seed',
      });
      return true;
    });
    if (created) findingsCreated += 1;
    else findingsExisting += 1;
  }
  return { sync, failed, findingsCreated, findingsExisting };
}
