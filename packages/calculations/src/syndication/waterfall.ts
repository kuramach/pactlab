import Decimal from 'decimal.js';
import { D } from '../metrics/decimal';

/**
 * Multifamily syndication waterfall (T-106): what the limited partners and the
 * sponsor receive from a property held for a few years and sold, under the
 * confirmed operating-agreement terms. Deterministic and decimal-only; it is a
 * scenario computed from stated assumptions, never a projection or promise.
 *
 * Conventions (returned with every result):
 * - Annual periods; contributions at year 0, distributions at each year end.
 * - Debt is interest-only and repaid in full at sale.
 * - The acquisition fee is paid from the raise at close; what the raise leaves
 *   after the equity in the property and that fee is held as reserves and
 *   returned at sale. Operating shortfalls draw on the reserves.
 * - The asset-management fee is a share of the raise, paid each year before
 *   distributions; the disposition fee is a share of the sale price.
 * - European (whole-fund) waterfall with IRR hurdles: 100% to the limited
 *   partners until they reach the preferred return (compounding annually,
 *   which also returns their capital), then each promote tier splits cash
 *   until the partners reach that tier's IRR hurdle; the last tier has none.
 * - A GP catch-up is not modelled; the sponsor's own co-investment is not
 *   modelled (the sponsor's return is its fees and its promote).
 */
export const WATERFALL_VERSION = 'syndication-waterfall-1';

type Dec = InstanceType<typeof D>;

export interface PromoteTier {
  /** The limited partners' IRR up to which this split applies (fraction); null for the last tier. */
  readonly hurdle: Dec | null;
  /** The sponsor's share of cash in this tier (fraction, below 1). */
  readonly gpShare: Dec;
}

export interface WaterfallTerms {
  /** Preferred return to the limited partners (fraction, e.g. 0.08). */
  readonly prefRate: Dec;
  /** Promote tiers after the preferred return, in hurdle order; the last has no hurdle. */
  readonly tiers: readonly PromoteTier[];
  /** Fractions: of the purchase price, of the raise per year, of the sale price. */
  readonly acquisitionFee: Dec;
  readonly assetManagementFee: Dec;
  readonly dispositionFee: Dec;
}

export interface PropertyPath {
  readonly purchasePrice: Dec;
  readonly loanAmount: Dec;
  /** Annual interest rate on the loan (fraction). */
  readonly interestRate: Dec;
  /** Limited partners' equity raised. */
  readonly equity: Dec;
  readonly holdYears: number;
  /** Net operating income in the first year held. */
  readonly noiYear1: Dec;
  /** Annual NOI growth (fraction). */
  readonly noiGrowth: Dec;
  /** Capitalization rate on the year-after-sale NOI (fraction). */
  readonly exitCapRate: Dec;
  /** Selling costs at exit (fraction of the sale price). */
  readonly sellingCosts: Dec;
}

export interface WaterfallYear {
  readonly year: number;
  readonly noi: string;
  readonly debtService: string;
  readonly assetManagementFee: string;
  readonly operatingCashFlow: string;
  readonly toLimitedPartners: string;
  readonly toSponsor: string;
}

export interface WaterfallResult {
  readonly version: typeof WATERFALL_VERSION;
  readonly years: readonly WaterfallYear[];
  readonly sale: {
    readonly salePrice: string;
    readonly sellingCosts: string;
    readonly dispositionFee: string;
    readonly loanRepaid: string;
    readonly reservesReturned: string;
    readonly netProceeds: string;
    readonly toLimitedPartners: string;
    readonly toSponsor: string;
  };
  readonly fees: { readonly acquisition: string; readonly assetManagement: string; readonly disposition: string; readonly total: string };
  readonly limitedPartners: {
    readonly contributed: string;
    readonly distributed: string;
    /** Percent to 2 dp; null when the flows have no IRR (e.g. nothing comes back). */
    readonly irr: string | null;
    /** Times, to 2 dp. */
    readonly equityMultiple: string;
    /** Average yearly operating distribution ÷ contribution, percent to 2 dp. */
    readonly averageCashOnCash: string;
  };
  readonly sponsor: { readonly promote: string; readonly fees: string };
  readonly conventions: readonly string[];
}

export class WaterfallError extends Error {
  constructor(readonly code: 'INVALID_TERMS' | 'INVALID_PATH' | 'EQUITY_SHORT', message: string) {
    super(message);
    this.name = 'WaterfallError';
  }
}

export const WATERFALL_CONVENTIONS: readonly string[] = [
  'Annual periods: contributions at year 0, distributions at each year end.',
  'Interest-only debt, repaid in full at sale.',
  'Acquisition fee paid from the raise at close; the remainder of the raise beyond the property equity is held as reserves and returned at sale.',
  'Asset-management fee is a share of the raise each year; disposition fee is a share of the sale price.',
  'European waterfall with IRR hurdles: 100% to limited partners to the preferred return (compounding annually, returning capital), then each promote tier to its IRR hurdle.',
  'Exit value is the year-after-sale NOI ÷ the exit cap rate.',
  'No GP catch-up and no sponsor co-investment are modelled.',
  'A scenario computed from stated assumptions — not a projection or promise.',
];

const ZERO = new D(0);
const ONE = new D(1);
const cents = (value: Dec) => value.toFixed(2, Decimal.ROUND_HALF_EVEN);
const pct2 = (value: Dec) => value.times(100).toFixed(2, Decimal.ROUND_HALF_EVEN);

function validate(terms: WaterfallTerms, path: PropertyPath): void {
  const fraction = (value: Dec) => value.gte(0) && value.lt(1);
  if (!fraction(terms.prefRate) || !fraction(terms.acquisitionFee) || !fraction(terms.assetManagementFee) || !fraction(terms.dispositionFee))
    throw new WaterfallError('INVALID_TERMS', 'Rates and fees must be fractions from 0 up to 1');
  if (terms.tiers.length === 0) throw new WaterfallError('INVALID_TERMS', 'At least one promote tier (the split after the preferred return) is needed');
  terms.tiers.forEach((tier, index) => {
    if (!fraction(tier.gpShare)) throw new WaterfallError('INVALID_TERMS', 'A sponsor share must be from 0 up to 1');
    const last = index === terms.tiers.length - 1;
    if (last !== (tier.hurdle === null)) throw new WaterfallError('INVALID_TERMS', 'Only the last promote tier has no hurdle');
    const floor = index === 0 ? terms.prefRate : terms.tiers[index - 1]?.hurdle;
    if (tier.hurdle && floor && tier.hurdle.lte(floor)) throw new WaterfallError('INVALID_TERMS', 'Promote hurdles must rise above the preferred return');
  });
  if (!Number.isInteger(path.holdYears) || path.holdYears < 1 || path.holdYears > 30) throw new WaterfallError('INVALID_PATH', 'Hold must be 1 to 30 whole years');
  if (path.purchasePrice.lte(0) || path.equity.lte(0) || path.loanAmount.lt(0) || path.loanAmount.gte(path.purchasePrice))
    throw new WaterfallError('INVALID_PATH', 'Price and equity must be positive and the loan below the price');
  if (path.exitCapRate.lte(0) || path.exitCapRate.gte(1) || path.interestRate.lt(0) || path.interestRate.gte(1) || !fraction(path.sellingCosts))
    throw new WaterfallError('INVALID_PATH', 'Cap rate, interest rate and selling costs must be fractions');
  if (path.noiGrowth.lte(-1) || path.noiGrowth.gte(1)) throw new WaterfallError('INVALID_PATH', 'NOI growth must be between −100% and 100%');
}

/**
 * Split one distribution through the IRR-hurdle tiers. `balances[k]` is what
 * the partners still need to reach hurdle k (pref first, then each tier with a
 * hurdle), already grown to this period; they shrink by what the partners get.
 */
function distribute(cash: Dec, balances: Dec[], terms: WaterfallTerms): { lp: Dec; gp: Dec } {
  let rest = cash;
  let lp = ZERO;
  let gp = ZERO;
  // Tier 0: everything to the partners up to the preferred return.
  const toPref = Decimal.min(rest, Decimal.max(ZERO, balances[0] ?? ZERO));
  lp = lp.plus(toPref);
  rest = rest.minus(toPref);
  terms.tiers.forEach((tier, index) => {
    if (rest.lte(0)) return;
    const lpShare = ONE.minus(tier.gpShare);
    let slice = rest;
    if (tier.hurdle !== null) {
      const need = Decimal.max(ZERO, (balances[index + 1] ?? ZERO).minus(lp));
      slice = Decimal.min(rest, need.dividedBy(lpShare));
    }
    lp = lp.plus(slice.times(lpShare));
    gp = gp.plus(slice.times(tier.gpShare));
    rest = rest.minus(slice);
  });
  balances.forEach((balance, k) => (balances[k] = balance.minus(lp)));
  return { lp, gp };
}

/** IRR of yearly flows by bisection (decimal); null when NPV does not change sign in (−99%, 1000%). */
export function irr(flows: readonly Dec[]): Dec | null {
  const npv = (rate: Dec) => flows.reduce((total, flow, year) => total.plus(flow.dividedBy(ONE.plus(rate).pow(year))), ZERO);
  let low = new D('-0.99');
  let high = new D(10);
  let npvLow = npv(low);
  if (npvLow.isZero()) return low;
  if (npvLow.isPositive() === npv(high).isPositive()) return null;
  for (let step = 0; step < 200; step += 1) {
    const mid = low.plus(high).dividedBy(2);
    const value = npv(mid);
    if (value.isZero() || high.minus(low).lt('1e-12')) return mid;
    if (value.isPositive() === npvLow.isPositive()) {
      low = mid;
      npvLow = value;
    } else high = mid;
  }
  return low.plus(high).dividedBy(2);
}

export function runWaterfall(terms: WaterfallTerms, path: PropertyPath): WaterfallResult {
  validate(terms, path);
  const acquisitionFee = path.purchasePrice.times(terms.acquisitionFee);
  let reserves = path.equity.minus(path.purchasePrice.minus(path.loanAmount)).minus(acquisitionFee);
  if (reserves.lt(0)) throw new WaterfallError('EQUITY_SHORT', 'The raise does not cover the price less the loan plus the acquisition fee');
  const hurdles = [terms.prefRate, ...terms.tiers.flatMap((tier) => (tier.hurdle ? [tier.hurdle] : []))];
  const balances = hurdles.map(() => path.equity);
  const flows: Dec[] = [path.equity.negated()];
  const years: WaterfallYear[] = [];
  const debtService = path.loanAmount.times(path.interestRate);
  const amFee = path.equity.times(terms.assetManagementFee);
  let operatingToLp = ZERO;
  let promote = ZERO;
  for (let year = 1; year <= path.holdYears; year += 1) {
    balances.forEach((balance, k) => (balances[k] = balance.times(ONE.plus(hurdles[k] ?? ZERO))));
    const noi = path.noiYear1.times(ONE.plus(path.noiGrowth).pow(year - 1));
    const cash = noi.minus(debtService).minus(amFee);
    let paid = { lp: ZERO, gp: ZERO };
    if (cash.gt(0)) paid = distribute(cash, balances, terms);
    else reserves = reserves.plus(cash);
    operatingToLp = operatingToLp.plus(paid.lp);
    promote = promote.plus(paid.gp);
    flows.push(paid.lp);
    years.push({ year, noi: cents(noi), debtService: cents(debtService), assetManagementFee: cents(amFee), operatingCashFlow: cents(cash), toLimitedPartners: cents(paid.lp), toSponsor: cents(paid.gp) });
  }
  const forwardNoi = path.noiYear1.times(ONE.plus(path.noiGrowth).pow(path.holdYears));
  const salePrice = forwardNoi.dividedBy(path.exitCapRate);
  const sellingCosts = salePrice.times(path.sellingCosts);
  const dispositionFee = salePrice.times(terms.dispositionFee);
  const net = Decimal.max(ZERO, salePrice.minus(sellingCosts).minus(dispositionFee).minus(path.loanAmount).plus(reserves));
  const sale = distribute(net, balances, terms);
  flows.push((flows.pop() ?? ZERO).plus(sale.lp));
  promote = promote.plus(sale.gp);
  const distributed = flows.slice(1).reduce((total, flow) => total.plus(flow), ZERO);
  const rate = irr(flows);
  const assetManagement = amFee.times(path.holdYears);
  const fees = acquisitionFee.plus(assetManagement).plus(dispositionFee);
  return {
    version: WATERFALL_VERSION,
    years,
    sale: {
      salePrice: cents(salePrice),
      sellingCosts: cents(sellingCosts),
      dispositionFee: cents(dispositionFee),
      loanRepaid: cents(path.loanAmount),
      reservesReturned: cents(reserves),
      netProceeds: cents(net),
      toLimitedPartners: cents(sale.lp),
      toSponsor: cents(sale.gp),
    },
    fees: { acquisition: cents(acquisitionFee), assetManagement: cents(assetManagement), disposition: cents(dispositionFee), total: cents(fees) },
    limitedPartners: {
      contributed: cents(path.equity),
      distributed: cents(distributed),
      irr: rate === null ? null : pct2(rate),
      equityMultiple: distributed.dividedBy(path.equity).toFixed(2, Decimal.ROUND_HALF_EVEN),
      averageCashOnCash: pct2(operatingToLp.dividedBy(path.holdYears).dividedBy(path.equity)),
    },
    sponsor: { promote: cents(promote), fees: cents(fees) },
    conventions: WATERFALL_CONVENTIONS,
  };
}
