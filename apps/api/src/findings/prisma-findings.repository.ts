import {
  appendAuditEvent,
  enqueueOutboxEvent,
  findings,
  withTenant,
  type AuditEventInput,
  type PrismaClient,
} from '@pactlab/db';
import type { Finding, FindingReview, TenantContext } from '@pactlab/domain';
import type { FindingFilter, FindingsRepository, FindingWithReviews } from './findings.repository';

/**
 * RLS-backed findings persistence. Every call runs as `pactlab_app` inside
 * the caller's tenant context; each change, its audit event and (for review
 * decisions) its outbox event commit in one transaction.
 */
export class PrismaFindingsRepository implements FindingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(tenant: TenantContext, dealId: string, filter: FindingFilter): Promise<Finding[]> {
    return withTenant(this.prisma, tenant, (tx) => findings.list(tx, dealId, filter));
  }

  get(tenant: TenantContext, dealId: string, findingId: string): Promise<FindingWithReviews | null> {
    return withTenant(this.prisma, tenant, (tx) => findings.get(tx, dealId, findingId));
  }

  findByFingerprint(tenant: TenantContext, dealId: string, fingerprint: string): Promise<Finding | null> {
    return withTenant(this.prisma, tenant, (tx) => findings.findByFingerprint(tx, dealId, fingerprint));
  }

  async insert(tenant: TenantContext, finding: Finding, audit: AuditEventInput): Promise<void> {
    await withTenant(this.prisma, tenant, async (tx) => {
      await findings.insert(tx, finding);
      await appendAuditEvent(tx, audit);
    });
  }

  update(
    tenant: TenantContext,
    finding: Finding,
    expectedVersion: number,
    review: FindingReview | null,
    audit: AuditEventInput,
  ): Promise<boolean> {
    return withTenant(this.prisma, tenant, async (tx) => {
      if (!(await findings.update(tx, finding, expectedVersion, review))) return false;
      await appendAuditEvent(tx, audit);
      if (review) {
        // Durable trigger for downstream staleness (valuation scenarios).
        await enqueueOutboxEvent(tx, {
          organizationId: finding.organizationId,
          dealId: finding.dealId,
          aggregateType: 'finding',
          aggregateId: finding.id,
          eventType: `finding.${review.decision.toLowerCase()}`,
          payload: {
            findingId: finding.id,
            status: finding.status,
            version: finding.version,
            reviewId: review.id,
          },
          idempotencyKey: `finding:${finding.id}:v${finding.version}`,
        });
      }
      return true;
    });
  }
}
