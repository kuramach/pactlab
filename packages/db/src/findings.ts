import type {
  Finding,
  FindingActor,
  FindingEvidenceLink,
  FindingReview,
  FindingStatus,
  PricedRisk,
  ValuationDirection,
  ValueConfirmation,
} from '@pactlab/domain';
import type { Prisma, TransactionClient } from './client';
import { afterCursor, toPage, type PageRequest, type PageResult } from './pagination';
import { DbNull } from './generated/prisma/internal/prismaNamespace';

export interface FindingRowFilter {
  readonly status?: FindingStatus | undefined;
  readonly domain?: Finding['domain'] | undefined;
  /** Only findings brought in from document review (fingerprint `document:`). */
  readonly source?: 'document-review' | undefined;
}

/** What a page of findings can be narrowed by, in the database (T-126). */
export interface FindingPageFilter extends FindingRowFilter {
  /** Title contains (case-insensitive). */
  readonly query?: string | undefined;
  readonly direction?: -1 | 0 | 1 | undefined;
  /** Risks (-1) still without a priced range, not rejected. */
  readonly pricingNeeded?: boolean | undefined;
  /** Leave out value confirmations (cushions): for callers without the confidential scope. */
  readonly excludeValueConfirmations?: boolean | undefined;
  /** Only these findings (a lookup by id; at most 100). */
  readonly ids?: readonly string[] | undefined;
  /** Leave out rejected findings. */
  readonly excludeRejected?: boolean | undefined;
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
    documentCitation: (row.documentCitation ?? null) as FindingEvidenceLink['documentCitation'],
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

function toValueConfirmation(row: FindingRow): ValueConfirmation | null {
  if (row.valueDriver === null) return null;
  return {
    valueDriver: row.valueDriver,
    basis: row.valueBasis ?? '',
    impliedValue:
      row.valueLow !== null && row.valueHigh !== null && row.valueCurrency !== null
        ? { low: row.valueLow.toFixed(), high: row.valueHigh.toFixed(), currency: row.valueCurrency }
        : null,
  };
}

const toDirection = (value: number | null): ValuationDirection | null => (value === -1 || value === 0 || value === 1 ? value : null);

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
    direction: toDirection(row.direction),
    valueConfirmation: toValueConfirmation(row),
    directionRationale: row.directionRationale,
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
    direction: toDirection(row.direction),
    directionRationale: row.directionRationale,
    decidedAt: row.decidedAt.toISOString(),
  };
}

function directionColumns(finding: Pick<Finding, 'direction' | 'valueConfirmation' | 'directionRationale'>) {
  const confirmation = finding.valueConfirmation;
  return {
    direction: finding.direction,
    valueDriver: confirmation?.valueDriver ?? null,
    valueBasis: confirmation?.basis ?? null,
    valueLow: confirmation?.impliedValue?.low ?? null,
    valueHigh: confirmation?.impliedValue?.high ?? null,
    valueCurrency: confirmation?.impliedValue?.currency ?? null,
    directionRationale: finding.directionRationale,
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
  return finding.evidence.map(({ documentCitation, ...link }, ordinal) => ({
    organizationId: finding.organizationId,
    dealId: finding.dealId,
    findingId: finding.id,
    findingVersion,
    ordinal,
    ...link,
    // A JSON column takes DbNull, not null, for "no document citation".
    documentCitation: documentCitation ? (documentCitation as unknown as Prisma.InputJsonValue) : DbNull,
  }));
}

const sameLinks = (a: readonly FindingEvidenceLink[], b: readonly FindingEvidenceLink[]) =>
  a.length === b.length &&
  a.every((link, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      (Object.keys(link) as (keyof FindingEvidenceLink)[]).every((key) =>
        key === 'documentCitation' ? JSON.stringify(link[key]) === JSON.stringify(other[key]) : link[key] === other[key],
      )
    );
  });

/** All functions take a tenant-scoped transaction from `withTenant`; RLS does the scoping. */
export const findings = {
  /** Every finding matching, for calculations over the whole set (valuation, pricing, the pact report); screens use `page`. */
  async list(tx: TransactionClient, dealId: string, filter: FindingRowFilter): Promise<Finding[]> {
    // whole-set: valuation, pricing and the pact report compute over every matching finding; screens page through findings.page
    const rows = await tx.finding.findMany({
      where: {
        dealId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.domain ? { domain: filter.domain } : {}),
        ...(filter.source === 'document-review' ? { fingerprint: { startsWith: 'document:' } } : {}),
      },
      include: findingInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toFinding);
  },

  /** Counts across every matching finding (the charts on a paged list): by severity, by status, and risks needing a price. */
  async summary(tx: TransactionClient, dealId: string, filter: FindingRowFilter): Promise<{ total: number; bySeverity: Record<string, number>; byStatus: Record<string, number>; pricingNeeded: number }> {
    const matching = {
      dealId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.domain ? { domain: filter.domain } : {}),
      ...(filter.source === 'document-review' ? { fingerprint: { startsWith: 'document:' } } : {}),
    };
    const [grouped, pricingNeeded] = await Promise.all([
      tx.finding.groupBy({ by: ['severity', 'status'], where: matching, _count: { _all: true } }),
      tx.finding.count({ where: { ...matching, AND: [{ direction: -1, pricedRiskType: null, status: { not: 'REJECTED' } }] } }),
    ]);
    const bySeverity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of grouped) {
      total += row._count._all;
      bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + row._count._all;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + row._count._all;
    }
    return { total, bySeverity, byStatus, pricingNeeded };
  },

  /** Findings, oldest first, a page at a time (T-126), every filter in the database. */
  async page(tx: TransactionClient, dealId: string, filter: FindingPageFilter, request: PageRequest): Promise<PageResult<Finding>> {
    const matching = {
      dealId,
      ...(filter.status ? { status: filter.status } : filter.excludeRejected ? { status: { not: 'REJECTED' as const } } : {}),
      ...(filter.domain ? { domain: filter.domain } : {}),
      ...(filter.source === 'document-review' ? { fingerprint: { startsWith: 'document:' } } : {}),
      ...(filter.query ? { title: { contains: filter.query, mode: 'insensitive' as const } } : {}),
      ...(filter.direction !== undefined ? { direction: filter.direction } : {}),
      ...(filter.ids ? { id: { in: [...filter.ids] } } : {}),
      AND: [
        ...(filter.pricingNeeded ? [{ direction: -1, pricedRiskType: null, status: { not: 'REJECTED' as const } }] : []),
        ...(filter.excludeValueConfirmations ? [{ NOT: { direction: 1, valueDriver: { not: null } } }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      tx.finding.findMany({
        where: { AND: [matching, afterCursor('createdAt', request.cursor, { direction: 'asc', asDate: true })] },
        include: findingInclude,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: request.limit + 1,
      }),
      tx.finding.count({ where: matching }),
    ]);
    return toPage(rows, request, total, (row) => row.createdAt, toFinding);
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
        ...directionColumns(finding),
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
        ...directionColumns(finding),
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
          direction: review.direction,
          directionRationale: review.directionRationale,
          decidedAt: new Date(review.decidedAt),
        },
      });
    }
    return true;
  },
};
