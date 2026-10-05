import type {
  Finding,
  FindingActor,
  FindingEvidenceLink,
  FindingReview,
  FindingStatus,
  PricedRisk,
} from '@pactlab/domain';
import type { Prisma, TransactionClient } from './client';

export interface FindingRowFilter {
  readonly status?: FindingStatus;
  readonly domain?: Finding['domain'];
}

const findingInclude = {
  evidenceLinks: { orderBy: [{ findingVersion: 'desc' }, { ordinal: 'asc' }] },
} as const satisfies Prisma.FindingInclude;

type FindingRow = Prisma.FindingGetPayload<{ include: typeof findingInclude }>;
type LinkRow = FindingRow['evidenceLinks'][number];
type ReviewRow = Prisma.FindingReviewGetPayload<object>;

function toLink(row: LinkRow): FindingEvidenceLink {
  return {
    evidenceItemId: row.evidenceItemId,
    commitSha: row.commitSha,
    toolName: row.toolName,
    toolVersion: row.toolVersion,
    rulesetVersion: row.rulesetVersion,
    path: row.path,
    lineStart: row.lineStart,
    lineEnd: row.lineEnd,
  };
}

function toPricedRisk(row: FindingRow): PricedRisk | null {
  if (row.pricedRiskType === null) return null;
  return {
    type: row.pricedRiskType,
    currency: row.pricedRiskCurrency ?? '',
    // numeric(19,4) read back as an exact, minimal decimal string (no
    // exponent, no trailing zeros); never through a JS number.
    low: row.pricedRiskLow?.toFixed() ?? '',
    high: row.pricedRiskHigh?.toFixed() ?? '',
    basis: row.pricedRiskBasis ?? '',
  };
}

function toFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    organizationId: row.organizationId,
    dealId: row.dealId,
    domain: row.domain,
    title: row.title,
    description: row.description,
    severity: row.severity,
    confidence: row.confidence,
    status: row.status,
    origin: row.origin,
    fingerprint: row.fingerprint,
    evidence: row.evidenceLinks
      .filter((link) => link.findingVersion === row.evidenceVersion)
      .map(toLink),
    pricedRisk: toPricedRisk(row),
    createdBy: row.createdBy as unknown as FindingActor,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toReview(row: ReviewRow): FindingReview {
  return {
    id: row.id,
    findingId: row.findingId,
    decision: row.decision,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    reviewerUserId: row.reviewerUserId,
    reviewerRole: row.reviewerRole,
    rationale: row.rationale,
    decidedAt: row.decidedAt.toISOString(),
  };
}

function pricedRiskColumns(risk: PricedRisk | null) {
  return {
    pricedRiskType: risk?.type ?? null,
    pricedRiskCurrency: risk?.currency ?? null,
    pricedRiskLow: risk?.low ?? null,
    pricedRiskHigh: risk?.high ?? null,
    pricedRiskBasis: risk?.basis ?? null,
  };
}

function linkRows(finding: Finding, findingVersion: number) {
  return finding.evidence.map((link, ordinal) => ({
    organizationId: finding.organizationId,
    dealId: finding.dealId,
    findingId: finding.id,
    findingVersion,
    ordinal,
    ...link,
  }));
}

const sameLinks = (a: readonly FindingEvidenceLink[], b: readonly FindingEvidenceLink[]) =>
  a.length === b.length &&
  a.every((link, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      (Object.keys(link) as (keyof FindingEvidenceLink)[]).every((key) => link[key] === other[key])
    );
  });

/** All functions take a tenant-scoped transaction from `withTenant`; RLS does the scoping. */
export const findings = {
  async list(tx: TransactionClient, dealId: string, filter: FindingRowFilter): Promise<Finding[]> {
    const rows = await tx.finding.findMany({
      where: {
        dealId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.domain ? { domain: filter.domain } : {}),
      },
      include: findingInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toFinding);
  },

  async get(
    tx: TransactionClient,
    dealId: string,
    findingId: string,
  ): Promise<{ finding: Finding; reviews: FindingReview[] } | null> {
    const row = await tx.finding.findFirst({
      where: { id: findingId, dealId },
      include: findingInclude,
    });
    if (!row) return null;
    const reviews = await tx.findingReview.findMany({
      where: { findingId, dealId },
      orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
    });
    return { finding: toFinding(row), reviews: reviews.map(toReview) };
  },

  async findByFingerprint(
    tx: TransactionClient,
    dealId: string,
    fingerprint: string,
  ): Promise<Finding | null> {
    const row = await tx.finding.findFirst({
      where: { dealId, fingerprint },
      include: findingInclude,
    });
    return row ? toFinding(row) : null;
  },

  async insert(tx: TransactionClient, finding: Finding): Promise<void> {
    await tx.finding.create({
      data: {
        id: finding.id,
        organizationId: finding.organizationId,
        dealId: finding.dealId,
        domain: finding.domain,
        title: finding.title,
        description: finding.description,
        severity: finding.severity,
        confidence: finding.confidence,
        status: finding.status,
        origin: finding.origin,
        fingerprint: finding.fingerprint,
        ...pricedRiskColumns(finding.pricedRisk),
        createdBy: finding.createdBy as unknown as Prisma.InputJsonValue,
        evidenceVersion: finding.version,
        version: finding.version,
        createdAt: new Date(finding.createdAt),
        updatedAt: new Date(finding.updatedAt),
      },
    });
    if (finding.evidence.length > 0) {
      await tx.findingEvidenceLink.createMany({ data: linkRows(finding, finding.version) });
    }
  },

  /**
   * Compare-and-set on `expectedVersion`. A changed evidence set is appended
   * as a new link set (insert-only history); the review, if any, is appended.
   * Returns false when the stored version has moved on.
   */
  async update(
    tx: TransactionClient,
    finding: Finding,
    expectedVersion: number,
    review: FindingReview | null,
  ): Promise<boolean> {
    const current = await tx.finding.findFirst({
      where: { id: finding.id, dealId: finding.dealId },
      include: findingInclude,
    });
    if (!current || current.version !== expectedVersion) return false;
    const evidenceChanged = !sameLinks(toFinding(current).evidence, finding.evidence);

    const updated = await tx.finding.updateMany({
      where: { id: finding.id, dealId: finding.dealId, version: expectedVersion },
      data: {
        title: finding.title,
        description: finding.description,
        severity: finding.severity,
        confidence: finding.confidence,
        status: finding.status,
        ...pricedRiskColumns(finding.pricedRisk),
        ...(evidenceChanged ? { evidenceVersion: finding.version } : {}),
        version: finding.version,
        updatedAt: new Date(finding.updatedAt),
      },
    });
    if (updated.count === 0) return false;

    if (evidenceChanged && finding.evidence.length > 0) {
      await tx.findingEvidenceLink.createMany({ data: linkRows(finding, finding.version) });
    }
    if (review) {
      await tx.findingReview.create({
        data: {
          id: review.id,
          organizationId: finding.organizationId,
          dealId: finding.dealId,
          findingId: review.findingId,
          decision: review.decision,
          fromStatus: review.fromStatus,
          toStatus: review.toStatus,
          reviewerUserId: review.reviewerUserId,
          reviewerRole: review.reviewerRole,
          rationale: review.rationale,
          decidedAt: new Date(review.decidedAt),
        },
      });
    }
    return true;
  },
};
