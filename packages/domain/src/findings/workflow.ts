import { isUuid } from '../ids';
import { canDraftFindings, canReviewFindings } from './access';
import { FindingValidationError, validatePricedRisk, validateValueConfirmation } from './priced-risk';
import {
  FINDING_CONFIDENCES,
  FINDING_DOMAINS,
  TECHNOLOGY_FINDING_DOMAINS,
  FINDING_SEVERITIES,
  type Finding,
  type FindingActor,
  type FindingDomain,
  type FindingEvidenceLink,
  type FindingReview,
  type FindingStatus,
  type PricedRisk,
  type ProposedFinding,
  type ReviewDecision,
  type ValuationDirection,
  type ValueConfirmation,
  VALUATION_DIRECTIONS,
} from './types';

export type FindingWorkflowErrorCode =
  | 'FORBIDDEN'
  | 'HUMAN_REQUIRED'
  | 'INVALID_TRANSITION'
  | 'EVIDENCE_REQUIRED'
  | 'RATIONALE_REQUIRED'
  | 'DIRECTION_REQUIRED'
  | 'DRAG_NEEDS_PRICE'
  | 'CUSHION_NEEDS_DRIVER'
  | 'NEUTRAL_NEEDS_RATIONALE';

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

/**
 * A link resolves only if it names an evidence item and a versioned tool, and
 * — for code evidence — an exact commit. Pack evidence (an imported row) has
 * no commit, so no repository path or line range either; technology findings
 * always need the commit (`requireCommitsFor`).
 */
export function validateEvidenceLink(link: FindingEvidenceLink): FindingEvidenceLink {
  if (!isUuid(link.evidenceItemId)) throw new FindingValidationError('Invalid evidence item id');
  if (link.commitSha !== null && !COMMIT_SHA.test(link.commitSha))
    throw new FindingValidationError('Evidence links need a full commit hash');
  if (link.commitSha === null && (link.path !== null || link.lineStart !== null || link.lineEnd !== null))
    throw new FindingValidationError('A repository path needs the commit it was read at');
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

/**
 * Money belongs to one direction only: a priced risk to a drag (or a finding
 * whose direction is not yet decided), a value confirmation to a cushion, and
 * neither to a neutral finding.
 */
function validateDirectionShape(input: {
  direction: ValuationDirection | null;
  pricedRisk: PricedRisk | null;
  valueConfirmation: ValueConfirmation | null;
  directionRationale: string | null;
}) {
  if (input.direction !== null && !(VALUATION_DIRECTIONS as readonly number[]).includes(input.direction))
    throw new FindingValidationError('Direction must be -1, 0 or 1');
  if (input.pricedRisk && (input.direction === 0 || input.direction === 1))
    throw new FindingValidationError('Only a drag carries a priced risk');
  if (input.valueConfirmation && input.direction !== 1)
    throw new FindingValidationError('Only a cushion carries a value confirmation');
  if (input.directionRationale !== null && input.directionRationale.length > MAX_TEXT)
    throw new FindingValidationError(`Rationale must be at most ${MAX_TEXT} characters`);
}

/** Technology findings cite code, so every link needs its exact commit. */
function requireCommitsFor(domain: FindingDomain, evidence: readonly FindingEvidenceLink[]) {
  if ((TECHNOLOGY_FINDING_DOMAINS as readonly string[]).includes(domain) && evidence.some((link) => link.commitSha === null))
    throw new FindingValidationError('Evidence links need a full commit hash');
}

function validateProposal(proposal: ProposedFinding): Required<ProposedFinding> {
  if (!FINDING_DOMAINS.includes(proposal.domain))
    throw new FindingValidationError('Unknown domain');
  requireCommitsFor(proposal.domain, proposal.evidence);
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
    ...directionFields(proposal),
  };
}

function directionFields(proposal: Pick<ProposedFinding, 'direction' | 'valueConfirmation' | 'directionRationale' | 'pricedRisk'>) {
  const fields = {
    direction: proposal.direction ?? null,
    valueConfirmation: proposal.valueConfirmation ? validateValueConfirmation(proposal.valueConfirmation) : null,
    directionRationale: proposal.directionRationale?.trim() || null,
  };
  validateDirectionShape({ ...fields, pricedRisk: proposal.pricedRisk });
  return fields;
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
  readonly direction?: ValuationDirection | null;
  readonly valueConfirmation?: ValueConfirmation | null;
  readonly directionRationale?: string | null;
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
/** The reviewer's direction on acceptance: confirm the proposal (omit) or override it with a rationale. */
export interface DirectionDecision {
  readonly direction?: ValuationDirection;
  readonly directionRationale?: string;
}

/**
 * The direction a finding is accepted with. The reviewer may confirm the
 * proposal or override it (with a rationale). A drag must already be priced,
 * a cushion must say what it confirms, and a neutral must say why.
 */
function acceptedDirection(finding: Finding, choice: DirectionDecision) {
  const override = choice.direction ?? null;
  const direction = override ?? finding.direction;
  if (direction === null)
    throw new FindingWorkflowError('DIRECTION_REQUIRED', 'Choose whether this finding is a drag, a cushion or neutral');
  if (!(VALUATION_DIRECTIONS as readonly number[]).includes(direction))
    throw new FindingValidationError('Direction must be -1, 0 or 1');
  const given = choice.directionRationale?.trim() || null;
  if (given !== null && given.length > MAX_TEXT) throw new FindingValidationError(`Rationale must be at most ${MAX_TEXT} characters`);
  const changed = override !== null && override !== finding.direction;
  if (changed && finding.direction !== null && given === null)
    throw new FindingWorkflowError('RATIONALE_REQUIRED', 'Say why you changed the proposed direction');
  const directionRationale = given ?? finding.directionRationale;
  if (direction === -1 && !finding.pricedRisk)
    throw new FindingWorkflowError('DRAG_NEEDS_PRICE', 'Price this drag before accepting it — send it back to the analyst');
  if (direction === 1 && !finding.valueConfirmation)
    throw new FindingWorkflowError('CUSHION_NEEDS_DRIVER', 'Say which value driver this cushion confirms before accepting it');
  if (direction === 0 && !directionRationale)
    throw new FindingWorkflowError('NEUTRAL_NEEDS_RATIONALE', 'Say why this finding does not move value');
  if (direction !== -1 && finding.pricedRisk)
    throw new FindingWorkflowError('INVALID_TRANSITION', 'Only a drag carries a priced risk — remove the price first');
  if (direction !== 1 && finding.valueConfirmation)
    throw new FindingWorkflowError('INVALID_TRANSITION', 'Only a cushion carries a value confirmation');
  return { direction, directionRationale };
}

export function decide(
  finding: Finding,
  decision: ReviewDecision,
  rationale: string,
  actor: FindingActor,
  context: { reviewId: string; now: string },
  choice: DirectionDecision = {},
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
  if (decision === 'ACCEPTED') {
    finding.evidence.forEach(validateEvidenceLink);
    requireCommitsFor(finding.domain, finding.evidence);
  }
  const decided = decision === 'ACCEPTED' ? acceptedDirection(finding, choice) : null;
  return {
    finding: {
      ...finding,
      ...(decided ?? {}),
      status: rule.to,
      updatedAt: context.now,
      version: finding.version + 1,
    },
    review: {
      id: context.reviewId,
      findingId: finding.id,
      decision,
      fromStatus: rule.from,
      toStatus: rule.to,
      reviewerUserId: human.userId,
      reviewerRole: human.role,
      rationale: reason,
      direction: decided?.direction ?? null,
      directionRationale: decided?.directionRationale ?? null,
      decidedAt: context.now,
    },
  };
}

/** Audit action name for a review decision. */
export function auditActionFor(decision: ReviewDecision): string {
  return `finding.${decision.toLowerCase()}`;
}
