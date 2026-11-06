import { formatDecimal } from '../../metrics/_lib/format';

/** Buyer personas (T-105): the shapes the pricing API returns, and their labels. */
export type Persona = 'QUALITY_COMPOUNDER' | 'VALUE_INVESTOR' | 'GRAVE_DANCER';
export type TermLever = 'PRICE_REDUCTION' | 'REMEDIATION_COST' | 'ESCROW' | 'INDEMNITY' | 'RETENTION' | 'EARNOUT' | 'SELLER_FINANCING';
export type ScenarioCase = 'DOWNSIDE' | 'BASE' | 'UPSIDE';

interface Money {
  amount: string;
  currency: string;
}

export interface PersonaOption {
  persona: Persona;
  label: string;
  descriptor: string;
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

export interface TermBatchView {
  id: string;
  version: number;
  evaluationId: string;
  currency: string;
  createdAt: string;
  proposedAt: string | null;
  terms: { ordinal: number; lever: TermLever; amount: string; currency: string; findingId: string | null; sellerNote: string }[];
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
  proposed: { version: number; proposedAt: string; currency: string; terms: { lever: TermLever; amount: string; currency: string; sellerNote: string }[] } | null;
}

export const LEVER_LABELS: Readonly<Record<TermLever, string>> = {
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
