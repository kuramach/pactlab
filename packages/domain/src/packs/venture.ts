/**
 * Venture Raise (T-083): the founder-side pack. The founder's own startup is
 * the seller; investors are the counterparty. Counterparty and round types
 * are pack-level vocabularies, not a new deal model. Several investors may
 * bid on one round: each bid is an offer inside the same pact.
 */
export const COUNTERPARTY_TYPES = ['ANGEL', 'INCUBATOR', 'VC'] as const;
export type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];
export const COUNTERPARTY_LABELS: Readonly<Record<CounterpartyType, string>> = {
  ANGEL: 'Angel investor',
  INCUBATOR: 'Incubator or accelerator',
  VC: 'Venture capital firm',
};

export const ROUND_TYPES = ['PRE_SEED', 'SEED_SAFE', 'SEED_NOTE', 'SEED_PRICED', 'SERIES_A'] as const;
export type RoundType = (typeof ROUND_TYPES)[number];
export const ROUND_LABELS: Readonly<Record<RoundType, string>> = {
  PRE_SEED: 'Pre-seed',
  SEED_SAFE: 'Seed on SAFEs',
  SEED_NOTE: 'Seed on convertible notes',
  SEED_PRICED: 'Priced seed',
  SERIES_A: 'Series A',
};

/** Where an investor's bid stands. There is no "recommended" state: the founder decides. */
export const OFFER_STATUSES = ['PROSPECT', 'TERM_SHEET', 'DECLINED', 'SIGNED'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export interface ReadinessItem {
  readonly id: string;
  readonly label: string;
  /** Why investors ask for it, in one line. */
  readonly why: string;
  readonly counterparties: readonly CounterpartyType[];
  /** Present when one of these is in the deal: an import, a document whose name matches, or a connection. */
  readonly satisfiedBy: { readonly importTarget?: string; readonly document?: RegExp; readonly connection?: string };
}

const ALL: readonly CounterpartyType[] = ['ANGEL', 'INCUBATOR', 'VC'];
const PROGRAM_AND_VC: readonly CounterpartyType[] = ['INCUBATOR', 'VC'];

/**
 * What each kind of investor will ask for. Angels move on trust and speed
 * (a light set); incubators run a fixed program list; venture firms run the
 * full institutional pass.
 */
export const READINESS_ITEMS: readonly ReadinessItem[] = [
  { id: 'deck', label: 'Pitch deck', why: 'The claims every other item is checked against.', counterparties: ALL, satisfiedBy: { document: /deck|pitch/i } },
  { id: 'cap-table', label: 'Cap table', why: 'Who owns what before the round, including SAFEs and the pool.', counterparties: ALL, satisfiedBy: { importTarget: 'VENTURE_CAP_TABLE' } },
  { id: 'billing', label: 'Billing export', why: 'Revenue the deck metrics must tie to.', counterparties: ALL, satisfiedBy: { importTarget: 'BILLING_INVOICE_LINE' } },
  { id: 'incorporation', label: 'Certificate of incorporation', why: 'Authorised and issued shares the cap table must match.', counterparties: ALL, satisfiedBy: { document: /certificate[-_ ]of[-_ ]incorporation|articles[-_ ]of[-_ ](incorporation|association)/i } },
  { id: 'founder-agreements', label: 'Founder agreements', why: 'Vesting and roles of the founding team.', counterparties: PROGRAM_AND_VC, satisfiedBy: { document: /founder.*agreement|stock[-_ ]purchase|restricted[-_ ]stock/i } },
  { id: 'financials', label: 'Monthly financials', why: 'Cash and burn, so runway can be checked.', counterparties: PROGRAM_AND_VC, satisfiedBy: { importTarget: 'VENTURE_FINANCIALS' } },
  { id: 'bylaws', label: 'Bylaws', why: 'Governance the new investors will join.', counterparties: ['VC'], satisfiedBy: { document: /bylaws/i } },
  { id: 'ip-assignments', label: 'IP assignment agreements', why: 'Proof the company owns what employees and contractors built.', counterparties: ['VC'], satisfiedBy: { document: /assignment|contractor|consulting[-_ ]agreement/i } },
  { id: '83b', label: '83(b) election confirmations', why: 'Founders’ early tax elections on vesting stock.', counterparties: ['VC'], satisfiedBy: { document: /83\s*\(?b\)?(?![a-z])/i } },
  { id: 'prior-rounds', label: 'Prior round documents (SAFEs, notes)', why: 'The instruments that convert in this round.', counterparties: ['VC'], satisfiedBy: { document: /(^|[-_ ])safe([-_ .]|$)|convertible[-_ ]note|simple[-_ ]agreement/i } },
  { id: 'code', label: 'Code repository access', why: 'Technical diligence reads the same history you can read first.', counterparties: ['VC'], satisfiedBy: { connection: 'github' } },
];

/** VC asks for the most, then incubators, then angels. */
const STRICTNESS: Readonly<Record<CounterpartyType, number>> = { ANGEL: 0, INCUBATOR: 1, VC: 2 };

/** The most demanding counterparty among those given (an angel when none). */
export function strictestCounterparty(types: readonly CounterpartyType[]): CounterpartyType {
  return types.reduce<CounterpartyType>((strictest, type) => (STRICTNESS[type] > STRICTNESS[strictest] ? type : strictest), 'ANGEL');
}

export interface ReadinessResult {
  readonly counterparty: CounterpartyType;
  readonly items: readonly (Omit<ReadinessItem, 'satisfiedBy' | 'counterparties'> & { readonly present: boolean; readonly evidence: string | null })[];
  readonly present: number;
  readonly total: number;
  readonly complete: boolean;
}

/** The checklist for one kind of investor, against what the deal already holds. */
export function readinessOf(
  counterparty: CounterpartyType,
  held: { readonly importTargets: readonly string[]; readonly documentNames: readonly string[]; readonly connectionProviders: readonly string[] },
): ReadinessResult {
  const items = READINESS_ITEMS.filter((item) => item.counterparties.includes(counterparty)).map((item) => {
    const { importTarget, document, connection } = item.satisfiedBy;
    const byImport = importTarget && held.importTargets.includes(importTarget) ? importTarget : null;
    const byDocument = document ? (held.documentNames.find((name) => document.test(name)) ?? null) : null;
    const byConnection = connection && held.connectionProviders.includes(connection) ? connection : null;
    const evidence = byImport ?? byDocument ?? byConnection;
    return { id: item.id, label: item.label, why: item.why, present: evidence !== null, evidence };
  });
  const present = items.filter((item) => item.present).length;
  return { counterparty, items, present, total: items.length, complete: present === items.length };
}
