/**
 * The three phases of a pact (T-071): Pre-Diligence screens whether the deal
 * is worth diligence at all, Diligence tests what is said against what is
 * observed, Post-Close preserves and enhances what was bought. The phase is
 * derived from the pipeline stage — never a second field to keep in sync.
 */
export const DEAL_STAGES = ['SCREENING', 'DILIGENCE', 'NEGOTIATION', 'SIGNED', 'CLOSED'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_PHASES = ['PRE', 'DILIGENCE', 'POST'] as const;
export type DealPhase = (typeof DEAL_PHASES)[number];

export const DEAL_PHASE_LABELS: Readonly<Record<DealPhase, string>> = {
  PRE: 'Pre-Diligence',
  DILIGENCE: 'Diligence',
  POST: 'Post-Close',
};

const PHASE_OF_STAGE: Readonly<Record<DealStage, DealPhase>> = {
  SCREENING: 'PRE',
  DILIGENCE: 'DILIGENCE',
  NEGOTIATION: 'DILIGENCE',
  SIGNED: 'DILIGENCE',
  CLOSED: 'POST',
};

/** The phase a stage belongs to; an unknown stage reads as Diligence (the core loop). */
export function phaseOf(stage: string): DealPhase {
  return PHASE_OF_STAGE[stage as DealStage] ?? 'DILIGENCE';
}

export const isDealStage = (value: string): value is DealStage => (DEAL_STAGES as readonly string[]).includes(value);

/** Screening ends in a verdict: GO promotes to Diligence, NO_GO archives, NEEDS_MORE stays in Pre. */
export const SCREENING_VERDICTS = ['GO', 'NO_GO', 'NEEDS_MORE'] as const;
export type ScreeningVerdict = (typeof SCREENING_VERDICTS)[number];

/** Said vs observed: a seller assertion tested against evidence. */
export const CLAIM_STATUSES = ['UNVERIFIED', 'VERIFIED', 'CONTRADICTED'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const POST_CLOSE_KINDS = ['ASSET', 'ACTION', 'WATCH'] as const;
export type PostCloseKind = (typeof POST_CLOSE_KINDS)[number];
export const POST_CLOSE_STATUSES = ['OPEN', 'DONE', 'LAPSED'] as const;
export type PostCloseStatus = (typeof POST_CLOSE_STATUSES)[number];
export const REVIEW_CADENCES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type ReviewCadence = (typeof REVIEW_CADENCES)[number];

/** A finding or balance-sheet item, as the post-close generator reads it (references only). */
export interface PostCloseSourceFinding {
  readonly id: string;
  readonly title: string;
  readonly status: 'DRAFT' | 'IN_REVIEW' | 'ACCEPTED' | 'REJECTED';
  readonly direction: number | null;
  readonly valueDriver: string | null;
  readonly pricedRiskType: 'PRICE_REDUCTION' | 'ESCROW' | 'INDEMNITY' | 'REMEDIATION_COST' | null;
}

export interface PostCloseProposal {
  readonly kind: PostCloseKind;
  readonly sourceType: 'FINDING';
  readonly sourceId: string;
  readonly title: string;
  readonly action: string;
  readonly cadence: ReviewCadence | null;
}

/**
 * What closing a deal puts on the post-close registers, derived from
 * diligence output (no re-entry): accepted cushions are assets to preserve;
 * escrow and indemnity become watch items; remediation and still-open
 * findings become actions. Rejected findings carry nothing forward.
 */
export function postCloseProposals(findings: readonly PostCloseSourceFinding[]): PostCloseProposal[] {
  const out: PostCloseProposal[] = [];
  for (const finding of findings) {
    if (finding.status === 'REJECTED') continue;
    const accepted = finding.status === 'ACCEPTED';
    if (accepted && finding.direction === 1) {
      out.push({
        kind: 'ASSET',
        sourceType: 'FINDING',
        sourceId: finding.id,
        title: finding.valueDriver ?? finding.title,
        action: `Preserve: ${finding.valueDriver ?? finding.title}. Confirm it still holds at each review.`,
        cadence: 'QUARTERLY',
      });
    }
    if (accepted && (finding.pricedRiskType === 'ESCROW' || finding.pricedRiskType === 'INDEMNITY')) {
      out.push({
        kind: 'WATCH',
        sourceType: 'FINDING',
        sourceId: finding.id,
        title: finding.title,
        action: finding.pricedRiskType === 'ESCROW' ? 'Track the escrow release conditions and date.' : 'Track the indemnity claim window; claim before it closes if the risk materialises.',
        cadence: null,
      });
    }
    if (accepted && finding.pricedRiskType === 'REMEDIATION_COST') {
      out.push({ kind: 'ACTION', sourceType: 'FINDING', sourceId: finding.id, title: finding.title, action: 'Carry out the priced remediation.', cadence: null });
    }
    if (!accepted) {
      out.push({ kind: 'ACTION', sourceType: 'FINDING', sourceId: finding.id, title: finding.title, action: 'Still open at close: resolve or accept the risk explicitly.', cadence: null });
    }
  }
  return out;
}
