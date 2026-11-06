import Decimal from 'decimal.js';
import { D, money, sum } from '../metrics/decimal';
import type { MoneyValue } from '../metrics/types';
import { adjustmentAmount, runValuation } from './engine';
import type { AdjustmentPoint, AdjustmentType, LinkedAdjustment, ValuationInputs, ValuationResult } from './types';

/**
 * Buyer personas (T-105, ADR 0021): a buyer's deal-making style, which prices
 * the same accepted findings differently. Every knob lives in PERSONA_PROFILE
 * as data, the same pattern as VALUATION_DIRECTION_MAP. A persona never touches
 * evidence, findings or directions: it only rewrites how linked priced risks
 * enter a valuation run, then weights the scenarios and orders the terms.
 */

/** Bumped whenever a persona knob, routing rule or weighting rule changes. */
export const PERSONA_VERSION = 'personas-1';

export const BUYER_PERSONAS = ['QUALITY_COMPOUNDER', 'VALUE_INVESTOR', 'GRAVE_DANCER'] as const;
export type BuyerPersona = (typeof BUYER_PERSONAS)[number];
export const DEFAULT_PERSONA: BuyerPersona = 'VALUE_INVESTOR';

export const SCENARIO_CASES = ['DOWNSIDE', 'BASE', 'UPSIDE'] as const;
export type ScenarioCase = (typeof SCENARIO_CASES)[number];

/** Deal-term levers: the four priced-risk types, plus the structures a persona adds. */
export const TERM_LEVERS = ['PRICE_REDUCTION', 'REMEDIATION_COST', 'ESCROW', 'INDEMNITY', 'RETENTION', 'EARNOUT', 'SELLER_FINANCING'] as const;
export type TermLever = (typeof TERM_LEVERS)[number];

export const BRIEF_TONES = ['QUALITY_AND_RISK', 'BALANCED', 'DOWNSIDE_AND_LEVERAGE'] as const;
export type BriefTone = (typeof BRIEF_TONES)[number];

/** Where a drag that does not clear the persona's materiality bar goes instead of the price. */
type ImmaterialRoute = 'INDEMNITY' | 'ESCROW';

export interface PersonaProfile {
  /** Customer-facing archetype name; never a person's name. */
  readonly label: string;
  readonly descriptor: string;
  /** Knob 1: drag translation. */
  readonly drag: {
    /** Which point of a priced-risk range a drag is priced at. */
    readonly point: AdjustmentPoint;
    /** Share of pre-adjustment enterprise value a price-reducing drag must clear to move the price. */
    readonly materiality: string;
    /** Where an immaterial price-reducing drag is carried instead (a holdback, never a price chip). */
    readonly immaterialRoute: ImmaterialRoute;
    /** Key-person price drags are carried as a retention holdback rather than a price chip. */
    readonly keyPersonAsRetention: boolean;
  };
  /** Knob 2: scenario weighting, downside / base / upside, summing to 1. */
  readonly weights: Readonly<Record<ScenarioCase, string>>;
  /** Knob 3: term lever preference, in the order proposals are listed, and the structures added. */
  readonly levers: {
    readonly order: readonly TermLever[];
    /** Share of the price deferred into an earnout. */
    readonly earnoutShare: string;
    /** Share of the price paid as a seller note. */
    readonly sellerFinancingShare: string;
  };
  /** Knob 4: the negotiation brief's framing. Tone follows posture; findings text never changes. */
  readonly briefTone: BriefTone;
}

export const PERSONA_PROFILE: Readonly<Record<BuyerPersona, PersonaProfile>> = {
  QUALITY_COMPOUNDER: {
    label: 'Quality Compounder',
    descriptor: 'A wonderful business at a fair price.',
    drag: { point: 'LOW', materiality: '0.02', immaterialRoute: 'INDEMNITY', keyPersonAsRetention: true },
    weights: { DOWNSIDE: '0.2', BASE: '0.5', UPSIDE: '0.3' },
    levers: {
      order: ['REMEDIATION_COST', 'INDEMNITY', 'RETENTION', 'ESCROW', 'PRICE_REDUCTION', 'EARNOUT', 'SELLER_FINANCING'],
      earnoutShare: '0',
      sellerFinancingShare: '0',
    },
    briefTone: 'QUALITY_AND_RISK',
  },
  VALUE_INVESTOR: {
    label: 'Value Investor',
    descriptor: 'Value at a good price.',
    drag: { point: 'MID', materiality: '0.005', immaterialRoute: 'ESCROW', keyPersonAsRetention: false },
    weights: { DOWNSIDE: '0.25', BASE: '0.5', UPSIDE: '0.25' },
    levers: {
      order: ['PRICE_REDUCTION', 'ESCROW', 'REMEDIATION_COST', 'INDEMNITY', 'EARNOUT', 'RETENTION', 'SELLER_FINANCING'],
      earnoutShare: '0.05',
      sellerFinancingShare: '0',
    },
    briefTone: 'BALANCED',
  },
  GRAVE_DANCER: {
    label: 'Grave Dancer',
    descriptor: 'Price to survive the bad case.',
    drag: { point: 'HIGH', materiality: '0', immaterialRoute: 'ESCROW', keyPersonAsRetention: false },
    weights: { DOWNSIDE: '0.5', BASE: '0.4', UPSIDE: '0.1' },
    levers: {
      order: ['ESCROW', 'PRICE_REDUCTION', 'EARNOUT', 'SELLER_FINANCING', 'INDEMNITY', 'REMEDIATION_COST', 'RETENTION'],
      earnoutShare: '0.15',
      sellerFinancingShare: '0.1',
    },
    briefTone: 'DOWNSIDE_AND_LEVERAGE',
  },
};

export function isBuyerPersona(value: unknown): value is BuyerPersona {
  return typeof value === 'string' && (BUYER_PERSONAS as readonly string[]).includes(value);
}

/** The persona a pact prices under: its own, else the organization default, else Value Investor. */
export function resolvePersona(pact: BuyerPersona | null | undefined, organizationDefault: BuyerPersona | null | undefined): BuyerPersona {
  return pact ?? organizationDefault ?? DEFAULT_PERSONA;
}

const PRICE_REDUCING: ReadonlySet<AdjustmentType> = new Set(['PRICE_REDUCTION', 'REMEDIATION_COST']);

/** How one linked priced risk entered a persona-priced run. */
export interface PersonaRouting {
  readonly findingId: string;
  /** The finding's own priced-risk type, unchanged on the finding. */
  readonly pricedRiskType: AdjustmentType;
  /** The type the engine applied in this run. */
  readonly appliedType: AdjustmentType;
  readonly lever: TermLever;
  readonly point: AdjustmentPoint;
  readonly reason: 'AS_PRICED' | 'BELOW_MATERIALITY' | 'KEY_PERSON_RETENTION';
}

export interface PersonaInputs {
  readonly inputs: ValuationInputs;
  readonly routing: readonly PersonaRouting[];
}

/**
 * Rewrite a run's linked priced risks for a persona: the range point, and,
 * for drags that do not clear the persona's materiality bar (or key-person
 * drags a Compounder would rather retain), the holdback that carries them in
 * place of a price chip. Everything else in the inputs is passed through, so
 * the engine itself never changes. `keyPersonFindings` names the linked
 * findings in the KEY_PERSON domain.
 */
export function personaInputs(
  inputs: ValuationInputs,
  persona: BuyerPersona,
  preAdjustmentEnterpriseValue: Decimal,
  keyPersonFindings: ReadonlySet<string> = new Set(),
): PersonaInputs {
  const { drag } = PERSONA_PROFILE[persona];
  const bar = Decimal.max(preAdjustmentEnterpriseValue, 0).times(drag.materiality);
  const routing: PersonaRouting[] = [];
  const adjustments = inputs.adjustments.map((adjustment): LinkedAdjustment => {
    const priced: LinkedAdjustment = { ...adjustment, point: drag.point };
    const route = (appliedType: AdjustmentType, lever: TermLever, reason: PersonaRouting['reason']) => {
      routing.push({ findingId: adjustment.findingId, pricedRiskType: adjustment.type, appliedType, lever, point: drag.point, reason });
      return { ...priced, type: appliedType };
    };
    if (PRICE_REDUCING.has(adjustment.type)) {
      if (drag.keyPersonAsRetention && keyPersonFindings.has(adjustment.findingId)) return route('ESCROW', 'RETENTION', 'KEY_PERSON_RETENTION');
      if (adjustmentAmount(priced).lessThan(bar)) return route(drag.immaterialRoute, drag.immaterialRoute, 'BELOW_MATERIALITY');
    }
    return route(adjustment.type, adjustment.type, 'AS_PRICED');
  });
  return { inputs: { ...inputs, adjustments }, routing };
}

/** One persona-priced run: the inputs as the engine saw them, how each priced risk was routed, and the result. */
export interface PersonaRun extends PersonaInputs {
  readonly persona: BuyerPersona;
  readonly personaVersion: typeof PERSONA_VERSION;
  readonly result: ValuationResult;
}

/** Price a scenario's inputs under a persona; materiality is measured against the scenario's own enterprise value. */
export function personaRun(inputs: ValuationInputs, persona: BuyerPersona, keyPersonFindings: ReadonlySet<string> = new Set()): PersonaRun {
  const enterpriseValue = new D(runValuation(inputs).enterpriseValue.amount);
  const priced = personaInputs(inputs, persona, enterpriseValue, keyPersonFindings);
  return { ...priced, persona, personaVersion: PERSONA_VERSION, result: runValuation(priced.inputs) };
}

export interface CasePrice {
  readonly case: ScenarioCase;
  /** The run's equity purchase price, as a decimal string. */
  readonly equityPurchasePrice: string;
}

/**
 * The persona-weighted equity purchase price across the cases present, with
 * the weights renormalised over them. Capped at the Base case's price when
 * there is one: upside weighting never pays above Base, so willingness to
 * pay for quality stays in the confirmed-value ledger, never in the price.
 */
export function weightedPrice(prices: readonly CasePrice[], persona: BuyerPersona): Decimal {
  if (prices.length === 0) throw new Error('A weighted price needs at least one scenario case');
  const weights = PERSONA_PROFILE[persona].weights;
  const total = sum(prices.map((price) => new D(weights[price.case])));
  const weighted = total.isZero()
    ? sum(prices.map((price) => new D(price.equityPurchasePrice))).dividedBy(prices.length)
    : sum(prices.map((price) => new D(price.equityPurchasePrice).times(weights[price.case]))).dividedBy(total);
  const base = prices.find((price) => price.case === 'BASE');
  return base ? Decimal.min(weighted, new D(base.equityPurchasePrice)) : weighted;
}

export interface TermLine {
  readonly lever: TermLever;
  readonly amount: MoneyValue;
  /** The finding a priced-risk lever carries; null for structures such as earnouts. */
  readonly findingId: string | null;
}

export interface TermMix {
  readonly persona: BuyerPersona;
  readonly personaVersion: typeof PERSONA_VERSION;
  readonly currency: string;
  readonly price: MoneyValue;
  readonly holdbacks: MoneyValue;
  readonly earnout: MoneyValue;
  readonly sellerFinancing: MoneyValue;
  readonly cashAtClose: MoneyValue;
  /** In the persona's lever order; within a lever, by finding id. */
  readonly lines: readonly TermLine[];
}

/**
 * The persona's term mix at a price: each routed priced risk as its lever,
 * plus the persona's earnout and seller note as shares of the price. Earnouts
 * and seller notes defer part of the price; they never change it.
 */
export function termMix(
  persona: BuyerPersona,
  price: Decimal,
  base: { readonly result: ValuationResult; readonly inputs: ValuationInputs; readonly routing: readonly PersonaRouting[] },
): TermMix {
  const profile = PERSONA_PROFILE[persona];
  const currency = base.result.currency;
  const byFinding = new Map(base.inputs.adjustments.map((adjustment) => [adjustment.findingId, adjustment]));
  const lines: { lever: TermLever; amount: Decimal; findingId: string | null }[] = base.routing.map((routing) => ({
    lever: routing.lever,
    amount: adjustmentAmount(byFinding.get(routing.findingId) as LinkedAdjustment),
    findingId: routing.findingId,
  }));
  const holdbacks = sum(lines.filter((entry) => !PRICE_REDUCING.has(entry.lever as AdjustmentType)).map((entry) => entry.amount));
  const earnout = price.times(profile.levers.earnoutShare);
  const sellerFinancing = price.times(profile.levers.sellerFinancingShare);
  if (earnout.greaterThan(0)) lines.push({ lever: 'EARNOUT', amount: earnout, findingId: null });
  if (sellerFinancing.greaterThan(0)) lines.push({ lever: 'SELLER_FINANCING', amount: sellerFinancing, findingId: null });
  const rank = (lever: TermLever) => profile.levers.order.indexOf(lever);
  lines.sort((a, b) => rank(a.lever) - rank(b.lever) || ((a.findingId ?? '') < (b.findingId ?? '') ? -1 : (a.findingId ?? '') > (b.findingId ?? '') ? 1 : 0));
  return {
    persona,
    personaVersion: PERSONA_VERSION,
    currency,
    price: money(price, currency),
    holdbacks: money(holdbacks, currency),
    earnout: money(earnout, currency),
    sellerFinancing: money(sellerFinancing, currency),
    cashAtClose: money(price.minus(holdbacks).minus(earnout).minus(sellerFinancing), currency),
    lines: lines.map((entry) => ({ lever: entry.lever, amount: money(entry.amount, currency), findingId: entry.findingId })),
  };
}
