import Decimal from 'decimal.js';
import { D } from '../../metrics/decimal';
import type { VehicleStatement, VehicleTerms } from './documents';

/**
 * Startup equity SPV vehicle economics (T-141, `spv-economics-1`): the fee load and carry the
 * operating agreement sets, checked against the summary investors were given, and net-of-fees
 * return scenarios on stated exit assumptions. Deterministic and decimal-only. Every scenario is
 * labelled a scenario computed from stated assumptions — never a projection or a promise.
 *
 * Conventions (returned with every result):
 * - The operating agreement governs; the investor summary is what investors were told.
 * - Fees and expenses come out of commitments before the vehicle invests: the management fee is
 *   its rate × commitments × the years it is charged; expenses are counted at their stated cap.
 * - The vehicle buys whole shares at the round price with what is left (rounded down).
 * - Exit value is the company's equity value at exit, stated as a multiple of the round's post-money;
 *   no later dilution, preference stack or taxes are modelled. Carry is charged on the vehicle's
 *   whole profit (over all commitments), with no hurdle; the organizer's own commitment is treated
 *   like any member's.
 */
export const SPV_ECONOMICS_VERSION = 'spv-economics-1';
type Dec = InstanceType<typeof D>;

export interface TermComparison {
  readonly term: 'MANAGEMENT_FEE' | 'CARRY' | 'EXPENSE_CAP';
  readonly label: string;
  readonly agreement: string | null;
  readonly summary: string | null;
  /** null when either document does not state the term. */
  readonly matches: boolean | null;
}

export interface SpvEconomics {
  readonly version: string;
  readonly currency: string | null;
  readonly commitments: string;
  readonly managementFeeRate: string | null;
  readonly managementFeeYears: string | null;
  readonly carryRate: string | null;
  readonly feeAmount: string | null;
  readonly expenseAmount: string | null;
  readonly invested: string | null;
  /** (fees + expenses) ÷ commitments. */
  readonly feeLoad: string | null;
  readonly organizerCommitment: string | null;
  readonly comparisons: readonly TermComparison[];
  readonly conventions: readonly string[];
}

const CONVENTIONS = [
  'The operating agreement governs; the investor summary is what investors were told.',
  'Fees and expenses come out of commitments before the vehicle invests: the management fee is its rate × commitments × the years charged; expenses count at their stated cap.',
  'The vehicle buys whole shares at the round price with what is left (rounded down).',
  'Exit value is the company’s equity value at exit as a multiple of the round’s post-money; no later dilution, preference stack or taxes; carry on the whole profit, no hurdle; the organizer’s own commitment counts like any member’s.',
] as const;
const ratio = (value: Dec) => value.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN).toFixed(4);
const pct = (value: Dec | null | undefined) => (value ? value.times(100).toFixed() : null);

function compare(agreement: VehicleTerms | null, summary: VehicleTerms | null): TermComparison[] {
  const fee = (terms: VehicleTerms | null) => (terms?.managementFee ? `${pct(terms.managementFee.value.rate)}%${terms.managementFee.value.years.gt(1) ? ` × ${terms.managementFee.value.years.toFixed()} years` : ''}` : null);
  const carry = (terms: VehicleTerms | null) => (terms?.carry ? `${pct(terms.carry.value)}%` : null);
  const cap = (terms: VehicleTerms | null) => (terms?.expenseCap ? `${terms.expenseCap.value.currency} ${terms.expenseCap.value.amount.toFixed()}` : null);
  const same = (a: string | null, b: string | null) => (a === null || b === null ? null : a === b);
  return [
    { term: 'MANAGEMENT_FEE', label: 'Management fee', agreement: fee(agreement), summary: fee(summary), matches: same(fee(agreement), fee(summary)) },
    { term: 'CARRY', label: 'Carried interest', agreement: carry(agreement), summary: carry(summary), matches: same(carry(agreement), carry(summary)) },
    { term: 'EXPENSE_CAP', label: 'Expenses', agreement: cap(agreement), summary: cap(summary), matches: same(cap(agreement), cap(summary)) },
  ];
}

/** The fee load on the vehicle's commitments, from the operating agreement's terms. */
export function spvEconomics(vehicle: VehicleStatement, commitments: Dec, currency: string | null): SpvEconomics {
  const terms = vehicle.agreement;
  const fee = terms?.managementFee ? commitments.times(terms.managementFee.value.rate).times(terms.managementFee.value.years) : null;
  const expenses = terms?.expenseCap ? terms.expenseCap.value.amount : terms ? new D(0) : null;
  const invested = fee !== null && expenses !== null ? commitments.minus(fee).minus(expenses) : null;
  return {
    version: SPV_ECONOMICS_VERSION,
    currency,
    commitments: commitments.toFixed(2),
    managementFeeRate: terms?.managementFee ? terms.managementFee.value.rate.toFixed() : null,
    managementFeeYears: terms?.managementFee ? terms.managementFee.value.years.toFixed() : null,
    carryRate: terms?.carry ? terms.carry.value.toFixed() : null,
    feeAmount: fee ? fee.toFixed(2) : null,
    expenseAmount: expenses ? expenses.toFixed(2) : null,
    invested: invested ? invested.toFixed(2) : null,
    feeLoad: fee !== null && expenses !== null && commitments.gt(0) ? ratio(fee.plus(expenses).div(commitments)) : null,
    organizerCommitment: terms?.organizerCommitment ? terms.organizerCommitment.value.amount.toFixed(2) : null,
    comparisons: compare(vehicle.agreement, vehicle.summary),
    conventions: CONVENTIONS,
  };
}

export const SPV_SCENARIOS = ['DOWNSIDE', 'BASE', 'UPSIDE'] as const;
export type SpvScenario = (typeof SPV_SCENARIOS)[number];

export interface SpvReturnScenario {
  readonly scenario: SpvScenario;
  /** The stated assumption: exit equity value ÷ the round's post-money. */
  readonly exitMultiple: string;
  readonly exitValue: string;
  readonly vehicleShares: string;
  readonly ownership: string;
  readonly proceeds: string;
  readonly carry: string;
  readonly netToInvestors: string;
  /** Net to investors ÷ commitments. */
  readonly netMultiple: string;
  readonly label: string;
}

export class SpvReturnsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpvReturnsError';
  }
}

/** Net-of-fees investor returns on each stated exit path. Needs the economics, the round price and the recomputed post-round shares. */
export function spvReturns(
  economics: SpvEconomics,
  round: { readonly pricePerShare: string | null; readonly postRoundShares: string | null },
  exits: Readonly<Partial<Record<SpvScenario, Dec>>>,
): SpvReturnScenario[] {
  if (!economics.invested || !round.pricePerShare || !round.postRoundShares) throw new SpvReturnsError('Needs the operating agreement’s fee terms, the round price and the recomputed post-round shares');
  const invested = new D(economics.invested);
  const price = new D(round.pricePerShare);
  const post = new D(round.postRoundShares);
  const commitments = new D(economics.commitments);
  const carryRate = new D(economics.carryRate ?? '0');
  if (!price.gt(0) || !post.gt(0) || !commitments.gt(0)) throw new SpvReturnsError('The round price, post-round shares and commitments must be positive');
  const shares = invested.gt(0) ? invested.div(price).floor() : new D(0);
  const ownership = shares.div(post.plus(0));
  const postMoney = post.times(price);
  return SPV_SCENARIOS.flatMap((scenario) => {
    const multiple = exits[scenario];
    if (!multiple || multiple.lt(0)) return [];
    const exitValue = postMoney.times(multiple);
    const proceeds = exitValue.times(ownership);
    const profit = proceeds.minus(commitments);
    const carry = profit.gt(0) ? profit.times(carryRate) : new D(0);
    const net = proceeds.minus(carry);
    return [
      {
        scenario,
        exitMultiple: multiple.toFixed(),
        exitValue: exitValue.toFixed(2),
        vehicleShares: shares.toFixed(0),
        ownership: ratio(ownership),
        proceeds: proceeds.toFixed(2),
        carry: carry.toFixed(2),
        netToInvestors: net.toFixed(2),
        netMultiple: net.div(commitments).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2),
        label: 'Scenario computed from stated assumptions — not a projection or promise.',
      },
    ];
  });
}
