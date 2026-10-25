import {
  PACK_FINDING_DOMAINS,
  type DocumentCitation,
  type FindingConfidence,
  type FindingEvidenceLink,
  type FindingSeverity,
  type PricedRisk,
  type ProposedFinding,
  type ValuationDirection,
  type ValueConfirmation,
} from './types';

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

/**
 * A stored document page a rule may read: only documents in classes rules are
 * allowed to see (never HR, compensation, performance or named contribution).
 * Rules match text deterministically; nothing is sent to a model.
 */
export interface RulePage {
  readonly documentId: string;
  readonly pageNumber: number;
  readonly text: string;
}

/** Everything one rule run reads. */
export interface RuleContext {
  readonly evidence: readonly RuleEvidence[];
  readonly pages: readonly RulePage[];
}

/** An exact quote from a page, cited by a proposal; verified before it is recorded. */
export interface RuleQuote {
  readonly documentId: string;
  readonly pageNumber: number;
  readonly quote: string;
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
  /** The evidence records the finding cites. */
  readonly evidenceIds: readonly string[];
  /** Document page quotes it cites; with `evidenceIds`, at least one citation in all. */
  readonly quotes?: readonly RuleQuote[];
  /**
   * A statement the finding settles for the claims register (T-083): e.g. a
   * deck metric VERIFIED or CONTRADICTED by billing. Recorded once, linked to
   * the finding and its evidence.
   */
  readonly claim?: RuleClaim | null;
}

export interface RuleClaim {
  readonly statement: string;
  readonly status: 'VERIFIED' | 'CONTRADICTED';
  readonly rationale: string;
}

export interface FindingRule {
  readonly id: string;
  readonly version: string;
  /** Evidence types the rule reads; others are never passed to it. */
  readonly evidenceTypes: readonly string[];
  /** Whether the rule reads document pages (otherwise none are loaded for it). */
  readonly readsDocuments?: boolean;
  readonly detect: (context: RuleContext) => readonly RuleProposal[];
}

export class FindingRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FindingRuleError';
  }
}

/**
 * Look a rule up in a registry. Rule implementations live in
 * `@pactlab/calculations` (decimal arithmetic); the API assembles the registry.
 */
export function findingRule(id: string, registry: Readonly<Record<string, FindingRule>>): FindingRule {
  const rule = registry[id];
  if (!rule) throw new FindingRuleError(`Unknown finding rule "${id}"`);
  return rule;
}

/** Verifies a quote against the stored page; null when it is not on that page (or the page is not readable). */
export type QuoteResolver = (quote: RuleQuote) => DocumentCitation | null;

export interface RuleRunResult {
  readonly proposals: ProposedFinding[];
  /** Claims the recorded proposals settle, by finding fingerprint. */
  readonly claims: readonly { readonly fingerprint: string; readonly claim: RuleClaim; readonly evidenceIds: readonly string[] }[];
  /** Proposals dropped because a cited quote did not resolve — reported, never passed silently. */
  readonly unresolved: number;
}

const link = (toolName: string, toolVersion: string, cite: { evidenceItemId: string } | { documentCitation: DocumentCitation }): FindingEvidenceLink => ({
  evidenceItemId: 'evidenceItemId' in cite ? cite.evidenceItemId : null,
  documentCitation: 'documentCitation' in cite ? cite.documentCitation : null,
  commitSha: null,
  toolName,
  toolVersion,
  rulesetVersion: null,
  path: null,
  lineStart: null,
  lineEnd: null,
});

/**
 * Run one rule and turn its proposals into draft findings. The fingerprint
 * binds rule id, version and proposal key, so a re-run is a no-op and a new
 * rule version proposes afresh. Evidence links carry no commit (pack rows);
 * page quotes become document citations only once `resolve` verifies them.
 */
export function ruleProposals(rule: FindingRule, context: RuleContext, resolve: QuoteResolver = () => null): RuleRunResult {
  const read = new Set(rule.evidenceTypes);
  const evidence = context.evidence.filter((item) => read.has(item.evidenceType));
  const pages = rule.readsDocuments ? context.pages : [];
  const known = new Set(evidence.map((item) => item.id));
  const tool = `pack-rule:${rule.id}`;
  let unresolved = 0;
  const proposals: ProposedFinding[] = [];
  const claims: { fingerprint: string; claim: RuleClaim; evidenceIds: readonly string[] }[] = [];
  for (const proposal of rule.detect({ evidence, pages })) {
    if (!(PACK_FINDING_DOMAINS as readonly string[]).includes(proposal.domain)) throw new FindingRuleError(`${rule.id}: not a pack domain`);
    const quotes = proposal.quotes ?? [];
    if (proposal.evidenceIds.length === 0 && quotes.length === 0) throw new FindingRuleError(`${rule.id}: a finding must cite evidence`);
    if (proposal.evidenceIds.some((id) => !known.has(id))) throw new FindingRuleError(`${rule.id}: cites evidence it was not given`);
    if (quotes.some((quote) => !pages.some((page) => page.documentId === quote.documentId && page.pageNumber === quote.pageNumber)))
      throw new FindingRuleError(`${rule.id}: quotes a page it was not given`);
    if (proposal.direction === 0 && !proposal.directionRationale?.trim()) throw new FindingRuleError(`${rule.id}: a neutral finding needs a rationale`);
    const citations = quotes.map(resolve);
    if (citations.some((citation) => citation === null)) {
      unresolved += 1;
      continue;
    }
    const fingerprint = `pack-rule:${rule.id}:${rule.version}:${proposal.key}`;
    if (proposal.claim) claims.push({ fingerprint, claim: proposal.claim, evidenceIds: [...new Set(proposal.evidenceIds)] });
    proposals.push({
      domain: proposal.domain,
      title: proposal.title,
      description: proposal.description,
      severity: proposal.severity,
      confidence: proposal.confidence,
      origin: 'HEURISTIC',
      fingerprint,
      evidence: [
        ...[...new Set(proposal.evidenceIds)].map((evidenceItemId) => link(tool, rule.version, { evidenceItemId })),
        ...citations.flatMap((citation) => (citation ? [link(tool, rule.version, { documentCitation: citation })] : [])),
      ],
      pricedRisk: proposal.pricedRisk ?? null,
      direction: proposal.direction,
      valueConfirmation: proposal.valueConfirmation ?? null,
      directionRationale: proposal.directionRationale ?? null,
    });
  }
  return { proposals, unresolved, claims };
}
