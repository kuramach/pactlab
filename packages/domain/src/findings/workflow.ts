import { isUuid } from '../ids';
import { canDraftFindings, canReviewFindings } from './access';
import { FindingValidationError, validatePricedRisk } from './priced-risk';
import {
  FINDING_CONFIDENCES,
  FINDING_DOMAINS,
  FINDING_SEVERITIES,
  type Finding,
  type FindingActor,
  type FindingEvidenceLink,
  type FindingReview,
  type FindingStatus,
  type PricedRisk,
  type ProposedFinding,
  type ReviewDecision,
} from './types';

export type FindingWorkflowErrorCode =
  | 'FORBIDDEN'
  | 'HUMAN_REQUIRED'
  | 'INVALID_TRANSITION'
  | 'EVIDENCE_REQUIRED'
  | 'RATIONALE_REQUIRED';

export class FindingWorkflowError extends Error {
  constructor(
    readonly code: FindingWorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FindingWorkflowError';
  }
}

const COMMIT_SHA = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_TITLE = 200;
const MAX_TEXT = 4_000;

function nonEmpty(value: string, max: number, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max)
    throw new FindingValidationError(`${field} must be 1-${max} characters`);
  return trimmed;
}

/** A link resolves only if it names an evidence item, an exact commit and a versioned tool. */
export function validateEvidenceLink(link: FindingEvidenceLink): FindingEvidenceLink {
  if (!isUuid(link.evidenceItemId)) throw new FindingValidationError('Invalid evidence item id');
  if (!COMMIT_SHA.test(link.commitSha))
    throw new FindingValidationError('Evidence links need a full commit hash');
  nonEmpty(link.toolName, 100, 'Tool name');
  nonEmpty(link.toolVersion, 100, 'Tool version');
  if (link.path !== null && (link.path.startsWith('/') || link.path.split('/').includes('..')))
    throw new FindingValidationError('Paths must be repository-relative');
  if (
    (link.lineStart !== null && (!Number.isInteger(link.lineStart) || link.lineStart < 1)) ||
    (link.lineEnd !== null &&
      (!Number.isInteger(link.lineEnd) || link.lineEnd < (link.lineStart ?? 1)))
  )
    throw new FindingValidationError('Invalid line range');
  return link;
}

function requireHuman(
  actor: FindingActor,
  allowed: (role: Extract<FindingActor, { kind: 'HUMAN' }>['role']) => boolean,
) {
  if (actor.kind !== 'HUMAN')
    throw new FindingWorkflowError('HUMAN_REQUIRED', 'Only a human may take this action');
  if (!allowed(actor.role))
    throw new FindingWorkflowError('FORBIDDEN', 'Role may not take this action');
  return actor;
}

function validateProposal(proposal: ProposedFinding): ProposedFinding {
  if (!FINDING_DOMAINS.includes(proposal.domain))
    throw new FindingValidationError('Unknown domain');
  if (!FINDING_SEVERITIES.includes(proposal.severity))
    throw new FindingValidationError('Unknown severity');
  if (!FINDING_CONFIDENCES.includes(proposal.confidence))
    throw new FindingValidationError('Unknown confidence');
  return {
    ...proposal,
    title: nonEmpty(proposal.title, MAX_TITLE, 'Title'),
    description: nonEmpty(proposal.description, MAX_TEXT, 'Description'),
    fingerprint: nonEmpty(proposal.fingerprint, 200, 'Fingerprint'),
    evidence: proposal.evidence.map(validateEvidenceLink),
    pricedRisk: proposal.pricedRisk ? validatePricedRisk(proposal.pricedRisk) : null,
  };
}

/**
 * Every finding starts as a DRAFT, whoever proposes it. AI and system actors
 * may draft; a human drafter needs write access to the deal.
 */
export function createDraft(
  proposal: ProposedFinding,
  actor: FindingActor,
  context: { id: string; organizationId: string; dealId: string; now: string },
): Finding {
  if (actor.kind === 'HUMAN') requireHuman(actor, canDraftFindings);
  const valid = validateProposal(proposal);
  return {
    ...valid,
    id: context.id,
    organizationId: context.organizationId,
    dealId: context.dealId,
    status: 'DRAFT',
    createdBy: actor,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
  };
}

export interface DraftPatch {
  readonly title?: string;
  readonly description?: string;
  readonly severity?: Finding['severity'];
  readonly confidence?: Finding['confidence'];
  readonly evidence?: readonly FindingEvidenceLink[];
  readonly pricedRisk?: PricedRisk | null;
}

/** Only drafts are editable, and only by a human with write access. */
export function editDraft(
  finding: Finding,
  patch: DraftPatch,
  actor: FindingActor,
  now: string,
): Finding {
  requireHuman(actor, canDraftFindings);
  if (finding.status !== 'DRAFT')
    throw new FindingWorkflowError('INVALID_TRANSITION', 'Only drafts can be edited');
  const merged = validateProposal({ ...finding, ...patch });
  return { ...finding, ...merged, updatedAt: now, version: finding.version + 1 };
}

const TRANSITIONS: Readonly<
  Record<ReviewDecision, { from: FindingStatus; to: FindingStatus; review: boolean }>
> = {
  SUBMITTED: { from: 'DRAFT', to: 'IN_REVIEW', review: false },
  SUPPORT_REQUESTED: { from: 'IN_REVIEW', to: 'DRAFT', review: true },
  ACCEPTED: { from: 'IN_REVIEW', to: 'ACCEPTED', review: true },
  REJECTED: { from: 'IN_REVIEW', to: 'REJECTED', review: true },
};

/**
 * The only way a finding changes status. Every transition is a human
 * decision with a rationale, recorded as an append-only review.
 * ACCEPTED additionally requires at least one resolvable evidence link.
 */
export function decide(
  finding: Finding,
  decision: ReviewDecision,
  rationale: string,
  actor: FindingActor,
  context: { reviewId: string; now: string },
): { finding: Finding; review: FindingReview } {
  const rule = TRANSITIONS[decision];
  const human = requireHuman(actor, rule.review ? canReviewFindings : canDraftFindings);
  if (finding.status !== rule.from)
    throw new FindingWorkflowError(
      'INVALID_TRANSITION',
      `Cannot record ${decision} on a ${finding.status} finding`,
    );
  const reason = rationale.trim();
  if (reason.length === 0 || reason.length > MAX_TEXT)
    throw new FindingWorkflowError('RATIONALE_REQUIRED', 'A rationale is required');
  if (decision === 'ACCEPTED' && finding.evidence.length === 0)
    throw new FindingWorkflowError(
      'EVIDENCE_REQUIRED',
      'A finding cannot be accepted without a resolvable evidence link',
    );
  if (decision === 'ACCEPTED') finding.evidence.forEach(validateEvidenceLink);
  return {
    finding: { ...finding, status: rule.to, updatedAt: context.now, version: finding.version + 1 },
    review: {
      id: context.reviewId,
      findingId: finding.id,
      decision,
      fromStatus: rule.from,
      toStatus: rule.to,
      reviewerUserId: human.userId,
      reviewerRole: human.role,
      rationale: reason,
      decidedAt: context.now,
    },
  };
}

/** Audit action name for a review decision. */
export function auditActionFor(decision: ReviewDecision): string {
  return `finding.${decision.toLowerCase()}`;
}
