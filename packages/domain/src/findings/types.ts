import type { DealRole } from '../roles';

export const FINDING_STATUSES = ['DRAFT', 'IN_REVIEW', 'ACCEPTED', 'REJECTED'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/** Findings are grouped by domain: technology review first, then pack domains (ADR 0009). */
export const TECHNOLOGY_FINDING_DOMAINS = [
  'ARCHITECTURE',
  'MAINTAINABILITY',
  'SECURITY',
  'OSS_LICENSE',
  'TEST_QUALITY',
  'OPERATIONS',
  'CODE_PROVENANCE',
  'KEY_PERSON',
] as const;
export const PACK_FINDING_DOMAINS = ['FINANCIAL', 'COMMERCIAL', 'OPERATIONAL', 'REGULATORY', 'LEGAL', 'PROPERTY', 'PEOPLE'] as const;
export const FINDING_DOMAINS = [...TECHNOLOGY_FINDING_DOMAINS, ...PACK_FINDING_DOMAINS] as const;
export type FindingDomain = (typeof FINDING_DOMAINS)[number];

export const FINDING_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_CONFIDENCES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type FindingConfidence = (typeof FINDING_CONFIDENCES)[number];

/** How a draft came to exist. Origin never changes what a reviewer must do. */
export const FINDING_ORIGINS = ['SCANNER', 'HEURISTIC', 'AI', 'HUMAN'] as const;
export type FindingOrigin = (typeof FINDING_ORIGINS)[number];

/**
 * Who performs a command. Only a HUMAN with a deal role may move a finding
 * past DRAFT; AI and system actors may only create drafts.
 */
export type FindingActor =
  | { readonly kind: 'HUMAN'; readonly userId: string; readonly role: DealRole }
  | { readonly kind: 'AI'; readonly promptVersion: string }
  | { readonly kind: 'SYSTEM'; readonly component: string };

/**
 * Resolvable provenance for a finding: the evidence item it cites, the exact
 * commit analysed when the evidence is code (null for pack evidence such as an
 * imported rent-roll row), and the tool, rule or scanner and its version.
 */
export interface FindingEvidenceLink {
  readonly evidenceItemId: string;
  readonly commitSha: string | null;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly rulesetVersion: string | null;
  /** Repository-relative path and line range; never file contents. */
  readonly path: string | null;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
}

export const PRICED_RISK_TYPES = [
  'PRICE_REDUCTION',
  'ESCROW',
  'INDEMNITY',
  'REMEDIATION_COST',
] as const;
export type PricedRiskType = (typeof PRICED_RISK_TYPES)[number];

/**
 * Proposed valuation adjustment carried by a finding. Amounts are decimal
 * strings with explicit currency; the valuation engine (not this record)
 * decides how an accepted adjustment changes a scenario.
 */
export interface PricedRisk {
  readonly type: PricedRiskType;
  readonly currency: string;
  readonly low: string;
  readonly high: string;
  readonly basis: string;
}

/**
 * How a finding moves value. A drag (-1) reprices the deal or hardens terms
 * and must carry a priced risk. A cushion (+1) confirms the thesis: it is
 * "value confirmed, not price paid" and never raises the price. Neutral (0)
 * is a recorded decision with a rationale, never the absence of data.
 * There is deliberately no price-increase adjustment.
 */
export const VALUATION_DIRECTIONS = [-1, 0, 1] as const;
export type ValuationDirection = (typeof VALUATION_DIRECTIONS)[number];

/** What a cushion confirms: the value driver, optionally an implied value range, and why. */
export interface ValueConfirmation {
  readonly valueDriver: string;
  readonly impliedValue: { readonly low: string; readonly high: string; readonly currency: string } | null;
  readonly basis: string;
}

export interface Finding {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly domain: FindingDomain;
  readonly title: string;
  readonly description: string;
  readonly severity: FindingSeverity;
  readonly confidence: FindingConfidence;
  readonly status: FindingStatus;
  readonly origin: FindingOrigin;
  /** Stable signal identity; re-running a scan on the same input yields the same fingerprint. */
  readonly fingerprint: string;
  readonly evidence: readonly FindingEvidenceLink[];
  readonly pricedRisk: PricedRisk | null;
  /** Proposed by the signal, then confirmed or overridden by the accepting reviewer. Null: not yet decided. */
  readonly direction: ValuationDirection | null;
  readonly valueConfirmation: ValueConfirmation | null;
  /** Why a finding is neutral, or why the reviewer changed the proposed direction. */
  readonly directionRationale: string | null;
  readonly createdBy: FindingActor;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Optimistic-concurrency version; every change increments it. */
  readonly version: number;
}

export const REVIEW_DECISIONS = ['SUBMITTED', 'SUPPORT_REQUESTED', 'ACCEPTED', 'REJECTED'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** Append-only record of one human decision on a finding. */
export interface FindingReview {
  readonly id: string;
  readonly findingId: string;
  readonly decision: ReviewDecision;
  readonly fromStatus: FindingStatus;
  readonly toStatus: FindingStatus;
  readonly reviewerUserId: string;
  readonly reviewerRole: DealRole;
  readonly rationale: string;
  /** The direction decided on acceptance; null for other decisions. */
  readonly direction: ValuationDirection | null;
  readonly directionRationale: string | null;
  readonly decidedAt: string;
}

/** A finding proposed by a scanner, heuristic or model, before it is persisted. */
export interface ProposedFinding {
  readonly domain: FindingDomain;
  readonly title: string;
  readonly description: string;
  readonly severity: FindingSeverity;
  readonly confidence: FindingConfidence;
  readonly origin: FindingOrigin;
  readonly fingerprint: string;
  readonly evidence: readonly FindingEvidenceLink[];
  readonly pricedRisk: PricedRisk | null;
  /** The signal's default direction; a person confirms or overrides it on acceptance. */
  readonly direction?: ValuationDirection | null;
  readonly valueConfirmation?: ValueConfirmation | null;
  readonly directionRationale?: string | null;
}
