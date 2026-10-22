import { PACK_FINDING_DOMAINS, type FindingConfidence, type FindingSeverity, type PricedRisk, type ProposedFinding, type ValuationDirection, type ValueConfirmation } from './types';

/**
 * Pack finding rules (ADR 0009): deterministic, versioned checks over a deal's
 * imported pack evidence. A rule only proposes DRAFT findings that cite the
 * rows they rest on; a named reviewer decides. No model is involved.
 */
export interface RuleEvidence {
  readonly id: string;
  readonly evidenceType: string;
  readonly sourceRecordId: string;
  readonly canonical: Readonly<Record<string, string | null>>;
}

export interface RuleProposal {
  /** Stable within the rule: the same evidence always yields the same key. */
  readonly key: string;
  readonly domain: (typeof PACK_FINDING_DOMAINS)[number];
  readonly title: string;
  readonly description: string;
  readonly severity: FindingSeverity;
  readonly confidence: FindingConfidence;
  /** −1 drag (priced), 0 neutral (with a rationale), +1 confirmed value — never a price increase. */
  readonly direction: ValuationDirection;
  readonly directionRationale?: string | null;
  readonly pricedRisk?: PricedRisk | null;
  readonly valueConfirmation?: ValueConfirmation | null;
  /** The evidence ids the finding cites; at least one. */
  readonly evidenceIds: readonly string[];
}

export interface FindingRule {
  readonly id: string;
  readonly version: string;
  /** Evidence types the rule reads; others are never passed to it. */
  readonly evidenceTypes: readonly string[];
  readonly detect: (evidence: readonly RuleEvidence[]) => readonly RuleProposal[];
}

export class FindingRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FindingRuleError';
  }
}

/** Every registered pack rule, by id. Each pack task adds its own (T-058+). */
export const FINDING_RULES: Readonly<Record<string, FindingRule>> = {};

export function findingRule(id: string, registry: Readonly<Record<string, FindingRule>> = FINDING_RULES): FindingRule {
  const rule = registry[id];
  if (!rule) throw new FindingRuleError(`Unknown finding rule "${id}"`);
  return rule;
}

/**
 * Run one rule and turn its proposals into draft findings. The fingerprint
 * binds rule id, version and proposal key, so a re-run is a no-op and a new
 * rule version proposes afresh. Evidence links carry no commit (pack rows).
 */
export function ruleProposals(rule: FindingRule, evidence: readonly RuleEvidence[]): ProposedFinding[] {
  const read = new Set(rule.evidenceTypes);
  const input = evidence.filter((item) => read.has(item.evidenceType));
  const known = new Set(input.map((item) => item.id));
  return rule.detect(input).map((proposal) => {
    if (!(PACK_FINDING_DOMAINS as readonly string[]).includes(proposal.domain)) throw new FindingRuleError(`${rule.id}: not a pack domain`);
    if (proposal.evidenceIds.length === 0) throw new FindingRuleError(`${rule.id}: a finding must cite evidence`);
    if (proposal.evidenceIds.some((id) => !known.has(id))) throw new FindingRuleError(`${rule.id}: cites evidence it was not given`);
    if (proposal.direction === 0 && !proposal.directionRationale?.trim()) throw new FindingRuleError(`${rule.id}: a neutral finding needs a rationale`);
    return {
      domain: proposal.domain,
      title: proposal.title,
      description: proposal.description,
      severity: proposal.severity,
      confidence: proposal.confidence,
      origin: 'HEURISTIC',
      fingerprint: `pack-rule:${rule.id}:${rule.version}:${proposal.key}`,
      evidence: [...new Set(proposal.evidenceIds)].map((evidenceItemId) => ({
        evidenceItemId,
        commitSha: null,
        toolName: `pack-rule:${rule.id}`,
        toolVersion: rule.version,
        rulesetVersion: null,
        path: null,
        lineStart: null,
        lineEnd: null,
      })),
      pricedRisk: proposal.pricedRisk ?? null,
      direction: proposal.direction,
      valueConfirmation: proposal.valueConfirmation ?? null,
      directionRationale: proposal.directionRationale ?? null,
    };
  });
}
