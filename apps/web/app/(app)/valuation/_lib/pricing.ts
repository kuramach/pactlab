import { formatDecimal } from '../../metrics/_lib/format';

/** Buyer personas (T-105): the shapes the pricing API returns, and their labels. */
export type Persona = 'QUALITY_COMPOUNDER' | 'VALUE_INVESTOR' | 'GRAVE_DANCER';
export type TermLever = 'PURCHASE_PRICE' | 'PRICE_REDUCTION' | 'REMEDIATION_COST' | 'ESCROW' | 'INDEMNITY' | 'RETENTION' | 'EARNOUT' | 'SELLER_FINANCING';
export type ScenarioCase = 'DOWNSIDE' | 'BASE' | 'UPSIDE';

interface Money {
  amount: string;
  currency: string;
}

export interface PersonaOption {
  persona: Persona;
  label: string;
  descriptor: string;
  /** Batch 1: what the picker shows at a glance. */
  icon: 'Gem' | 'Tag' | 'LifeBuoy';
  caption: string;
}

export interface TermMixView {
  persona: Persona;
  currency: string;
  price: Money;
  holdbacks: Money;
  earnout: Money;
  sellerFinancing: Money;
  cashAtClose: Money;
  lines: { lever: TermLever; amount: Money; findingId: string | null }[];
}

export interface EvaluationDeltaView {
  price: string;
  cashAtClose: string;
  holdbacks: string;
  earnout: string;
  sellerFinancing: string;
  levers: Partial<Record<TermLever, string>>;
}

export interface EvaluationView {
  id: string;
  persona: Persona;
  personaLabel: string;
  personaVersion: string;
  cases: { runId: string; scenarioId: string; scenarioName: string; case: ScenarioCase; equityPurchasePrice: string }[];
  termMix: TermMixView;
  createdBy: string;
  createdAt: string;
  deltaToActive: EvaluationDeltaView | null;
}

export type TermDecision = 'ACCEPT' | 'REJECT' | 'COUNTER';

export interface TermResponseView {
  decision: TermDecision;
  counterAmount: string | null;
  note: string;
  respondedAt: string;
}

export interface TermBatchView {
  id: string;
  version: number;
  evaluationId: string;
  currency: string;
  createdAt: string;
  proposedAt: string | null;
  agreedAt: string | null;
  declinedAt: string | null;
  /** Who proposed it (T-107); the other side answers. */
  initiatedBySide: 'BUYER' | 'SELLER';
  terms: { ordinal: number; lever: TermLever; amount: string; currency: string; findingId: string | null; sellerNote: string; response: TermResponseView | null }[];
}

export interface PricingView {
  persona: { pact: Persona | null; organizationDefault: Persona | null; effective: Persona; options: PersonaOption[] };
  active: { evaluationId: string; adoptedAt: string; adoptedBy: string } | null;
  evaluations: EvaluationView[];
  batches: TermBatchView[];
  sellerSeesOtherPricing: boolean;
  brief: { id: string; evaluationId: string; sections: { heading: string; body: string; citedFindingIds: string[] }[]; createdAt: string } | null;
}

export interface SellerTermsView {
  /** The caller's side on terms (T-107). */
  side: 'BUYER' | 'SELLER' | null;
  proposed: {
    id: string;
    version: number;
    proposedAt: string;
    currency: string;
    initiatedBySide: 'BUYER' | 'SELLER';
    agreedAt: string | null;
    declinedAt: string | null;
    canRespond: boolean;
    canAcceptCounters: boolean;
    terms: { ordinal: number; lever: TermLever; amount: string; currency: string; sellerNote: string; response: TermResponseView | null }[];
  } | null;
  /** The seller's own unproposed version (seller side only). */
  draft: { id: string; version: number; currency: string; terms: { ordinal: number; lever: TermLever; amount: string; currency: string; note: string }[] } | null;
}

export const DECISION_LABELS: Readonly<Record<TermDecision, string>> = { ACCEPT: 'Accepted', REJECT: 'Rejected', COUNTER: 'Countered' };

type Section = 'evaluate' | 'terms' | 'brief';
const MESSAGES: Readonly<Record<string, { section: Section; tone: 'ok' | 'problem'; text: string }>> = {
  'ok-evaluated': { section: 'evaluate', tone: 'ok', text: 'Evaluated under the new persona. The findings and earlier runs are unchanged.' },
  'ok-adopted': { section: 'evaluate', tone: 'ok', text: 'Adopted as the active pricing. Nothing changes for the seller until you propose terms.' },
  'ok-persona': { section: 'evaluate', tone: 'ok', text: 'Persona saved for this pact.' },
  'pricing-no-scenario': { section: 'evaluate', tone: 'problem', text: 'Create a valuation scenario (and tag Downside, Base or Upside) before pricing under a persona.' },
  'ok-drafted': { section: 'terms', tone: 'ok', text: 'Terms drafted from the active pricing. Add notes for the seller, then propose.' },
  'ok-counters': { section: 'terms', tone: 'ok', text: 'The seller’s counters are in the new draft. Check it, then propose it.' },
  'ok-notes': { section: 'terms', tone: 'ok', text: 'Seller notes saved.' },
  'ok-proposed': { section: 'terms', tone: 'ok', text: 'Terms proposed to the seller. They are frozen; draft a new version to change them.' },
  'adopt-first': { section: 'terms', tone: 'problem', text: 'Adopt a pricing evaluation before drafting terms.' },
  'terms-frozen': { section: 'terms', tone: 'problem', text: 'Those terms were already proposed or agreed and are frozen.' },
  'ok-brief': { section: 'brief', tone: 'ok', text: 'Negotiation brief drafted. It is for your team only.' },
  'brief-off': { section: 'brief', tone: 'problem', text: 'AI is off in this environment, so the brief can’t be drafted here.' },
  'brief-unavailable': { section: 'brief', tone: 'problem', text: 'Claude can’t be reached right now, so the brief wasn’t drafted. Try again shortly (on your own computer: sign in to AWS with `aws login`).' },
  'brief-no-findings': { section: 'brief', tone: 'problem', text: 'The active pricing carries no accepted findings to brief on.' },
};

/** The message for an action's outcome, if it belongs to this section of the pricing card. */
export function pricingMessage(outcome: string | undefined, section: Section): { tone: 'ok' | 'problem'; text: string } | null {
  const entry = outcome ? MESSAGES[outcome] : undefined;
  if (entry) return entry.section === section ? entry : null;
  // Generic failures show at the top of the card.
  if (section === 'evaluate' && outcome && ['forbidden', 'conflict', 'error', 'invalid', 'not-found', 'unavailable'].includes(outcome)) {
    return { tone: 'problem', text: outcome === 'forbidden' ? 'Your role cannot change pricing.' : 'That didn’t work. Reload and try again.' };
  }
  return null;
}

/** Where each outcome lands on the page, so the message is in view. */
export function pricingAnchor(outcome: string): string {
  const section = MESSAGES[outcome]?.section;
  return section === 'terms' ? 'pricing-terms' : section === 'brief' ? 'pricing-brief' : 'pricing';
}

export const LEVER_LABELS: Readonly<Record<TermLever, string>> = {
  PURCHASE_PRICE: 'Purchase price',
  PRICE_REDUCTION: 'Price reduction',
  REMEDIATION_COST: 'Remediation cost',
  ESCROW: 'Escrow holdback',
  INDEMNITY: 'Specific indemnity',
  RETENTION: 'Retention holdback',
  EARNOUT: 'Earnout',
  SELLER_FINANCING: 'Seller note',
};

export const CASE_LABELS: Readonly<Record<ScenarioCase, string>> = { DOWNSIDE: 'Downside', BASE: 'Base', UPSIDE: 'Upside' };

/** The newest evaluation under each persona, in persona order: what the compare view lines up. */
export function latestByPersona(evaluations: readonly EvaluationView[], order: readonly Persona[]): EvaluationView[] {
  return order.flatMap((persona) => {
    const found = evaluations.find((evaluation) => evaluation.persona === persona);
    return found ? [found] : [];
  });
}

/** A signed delta for the compare view: `+1,250,000.00`, `−400,000.00`, or `same` for zero. */
export function formatDelta(value: string | undefined): string {
  if (value === undefined || /^-?0(\.0+)?$/.test(value)) return 'same';
  return value.startsWith('-') ? `−${formatDecimal(value.slice(1))}` : `+${formatDecimal(value)}`;
}
