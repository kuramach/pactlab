import { REPOSITORY_HEAD_EVIDENCE_TYPE } from '@pactlab/connectors';
import {
  analyseKeyPersonRisk,
  createDraft,
  detectGhostCommits,
  ghostCommitFinding,
  healthyOwnershipFinding,
  keyPersonFindings,
  newId,
  type CommitMetadata,
  type ContributorIdentity,
  type FindingActor,
  type TenantContext,
} from '@pactlab/domain';
import { appendAuditEvent } from './audit';
import type { PrismaClient } from './client';
import { findings } from './findings';
import { withTenant } from './tenant';

/**
 * Record the ghost-commit and key-person signals for a synced repository as
 * DRAFT findings citing its head evidence and exact head commit. Idempotent by
 * fingerprint: a re-sync adds nothing already drafted. Nothing is submitted,
 * priced or accepted — those are human steps. Used by the seed and by every
 * GitHub sync (T-094 B8), so a connected repository produces the same
 * findings the seeded TroubledCo deal shows.
 */
export async function recordCodeSignalFindings(
  prisma: PrismaClient,
  tenant: TenantContext,
  input: {
    dealId: string;
    connectionId: string;
    head: { repository: string; headSha: string };
    commits: readonly CommitMetadata[];
    identityMap: readonly ContributorIdentity[];
    actor: FindingActor;
    requestId: string;
  },
): Promise<{ created: number; existing: number }> {
  const evidenceItem = await withTenant(prisma, tenant, (tx) =>
    tx.evidenceItem.findFirst({
      where: {
        dealId: input.dealId,
        connectionId: input.connectionId,
        evidenceType: REPOSITORY_HEAD_EVIDENCE_TYPE,
        sourceRecordId: `${input.head.repository}@${input.head.headSha}`,
      },
      select: { id: true },
    }),
  );
  if (!evidenceItem) return { created: 0, existing: 0 };
  const source = { evidenceItemId: evidenceItem.id, headCommitSha: input.head.headSha };
  const ghost = ghostCommitFinding(detectGhostCommits([...input.commits], [...input.identityMap]), source);
  const ownership = analyseKeyPersonRisk([...input.commits]);
  const healthy = healthyOwnershipFinding(ownership, source);
  const proposals = [...(ghost ? [ghost] : []), ...keyPersonFindings(ownership, source), ...(healthy ? [healthy] : [])];

  let created = 0;
  let existing = 0;
  for (const proposal of proposals) {
    const inserted = await withTenant(prisma, tenant, async (tx) => {
      if (await findings.findByFingerprint(tx, input.dealId, proposal.fingerprint)) return false;
      const finding = createDraft(proposal, input.actor, { id: newId(), organizationId: tenant.organizationId, dealId: input.dealId, now: new Date().toISOString() });
      await findings.insert(tx, finding);
      await appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId: input.dealId,
        actorUserId: null,
        action: 'finding.drafted',
        targetType: 'finding',
        targetId: finding.id,
        outcome: 'SUCCEEDED',
        requestId: input.requestId,
      });
      return true;
    });
    if (inserted) created += 1;
    else existing += 1;
  }
  return { created, existing };
}
