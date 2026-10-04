import type { AuditEventInput } from '@pactlab/db';
import type { Finding, FindingReview, FindingStatus, TenantContext } from '@pactlab/domain';

export const FINDINGS_REPOSITORY = Symbol('FINDINGS_REPOSITORY');

export interface FindingFilter {
  readonly status?: FindingStatus;
  readonly domain?: Finding['domain'];
}

export interface FindingWithReviews {
  readonly finding: Finding;
  /** Oldest first; append-only. */
  readonly reviews: readonly FindingReview[];
}

/**
 * Persistence port for findings, evidence links and append-only reviews.
 * Implementations run every call inside the caller's tenant context (RLS)
 * and write the supplied audit event in the same transaction as the change.
 */
export interface FindingsRepository {
  list(tenant: TenantContext, dealId: string, filter: FindingFilter): Promise<Finding[]>;
  get(tenant: TenantContext, dealId: string, findingId: string): Promise<FindingWithReviews | null>;
  findByFingerprint(
    tenant: TenantContext,
    dealId: string,
    fingerprint: string,
  ): Promise<Finding | null>;
  insert(tenant: TenantContext, finding: Finding, audit: AuditEventInput): Promise<void>;
  /** Returns false when `expectedVersion` is stale (optimistic concurrency). */
  update(
    tenant: TenantContext,
    finding: Finding,
    expectedVersion: number,
    review: FindingReview | null,
    audit: AuditEventInput,
  ): Promise<boolean>;
}
