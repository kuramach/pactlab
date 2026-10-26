import Decimal from 'decimal.js';
import { D } from '../metrics/decimal';

/**
 * Venture Raise round model (T-083): how a priced round converts the SAFE and
 * note stack, how the option-pool shuffle dilutes the founders, and who owns
 * what afterwards. Deterministic and decimal-only; it shows mechanics and
 * consequences and never recommends a term.
 *
 * Model (stated in every result):
 * - The pre-money is fully diluted and includes the pool increase and the
 *   converting SAFEs and notes ("pool shuffle": the pool is created before
 *   the money comes in, so existing holders bear it).
 * - Each SAFE or note converts at the lower of its cap price (cap ÷ the
 *   pre-money share count) and the round price less its discount. An MFN
 *   SAFE takes the best cap and discount of any SAFE issued after it.
 * - Note interest is not modelled. Converted, new and pool shares are whole
 *   shares: conversions and new shares round down; the pool rounds up so its
 *   target is met.
 */
export type HolderType = 'founder' | 'employee' | 'advisor' | 'investor' | 'pool';
export type Instrument = 'common' | 'preferred' | 'option' | 'pool_unallocated' | 'safe' | 'note';
type Dec = InstanceType<typeof D>;

export interface CapTableRow {
  readonly securityId: string;
  readonly holderRef: string;
  readonly holderType: HolderType;
  readonly instrument: Instrument;
  readonly shares: Dec | null;
  readonly principal: Dec | null;
  readonly valuationCap: Dec | null;
  /** Fraction, e.g. 0.20. */
  readonly discount: Dec | null;
  readonly mfn: boolean;
  readonly issuedOn: string | null;
}

export interface PricedRound {
  readonly preMoney: Dec;
  readonly amount: Dec;
  /** Unallocated pool after the round, as a fraction of post-money shares. */
  readonly poolTarget: Dec;
}

export interface Conversion {
  readonly securityId: string;
  readonly instrument: 'safe' | 'note';
  readonly principal: string;
  readonly price: string;
  readonly basis: 'CAP' | 'DISCOUNT' | 'ROUND_PRICE';
  readonly shares: string;
  /** Set when an MFN clause gave this instrument a later instrument's better terms. */
  readonly mfnFrom: string | null;
}

export interface RoundScenario {
  readonly preMoney: string;
  readonly amount: string;
  readonly postMoney: string;
  readonly pricePerShare: string;
  readonly sharesBefore: string;
  readonly poolIncrease: string;
  readonly newInvestorShares: string;
  readonly sharesAfter: string;
  readonly conversions: readonly Conversion[];
  /** Fully diluted ownership by holder type, before (SAFEs unconverted) and after, as percentages to 2 dp. */
  readonly ownership: readonly { readonly holderType: HolderType | 'new_investor'; readonly before: string; readonly after: string }[];
  readonly founders: { readonly before: string; readonly after: string };
  /** What the pool shuffle costs the founders: the pool's shares, and founder points against the same round with no pool increase. */
  readonly poolShuffle: { readonly shares: string; readonly founderPointsLost: string; readonly statement: string };
  readonly notes: readonly string[];
}

export class RoundModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoundModelError';
  }
}

const ZERO = new D(0);
const pct = (part: Dec, whole: Dec) => (whole.gt(0) ? part.div(whole).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2) : '0.00');
const isConverting = (row: CapTableRow) => row.instrument === 'safe' || row.instrument === 'note';
const outstanding = (rows: readonly CapTableRow[]) => rows.filter((row) => !isConverting(row));

/** Each converting instrument's effective cap and discount after MFN clauses. */
export function effectiveTerms(rows: readonly CapTableRow[]) {
  const converting = rows.filter(isConverting);
  return converting.map((row) => {
    if (!row.mfn) return { row, cap: row.valuationCap, discount: row.discount, mfnFrom: null as string | null };
    const later = converting.filter((other) => other !== row && (!row.issuedOn || !other.issuedOn || other.issuedOn > row.issuedOn));
    let cap = row.valuationCap;
    let discount = row.discount;
    let mfnFrom: string | null = null;
    for (const other of later) {
      if (other.valuationCap && (!cap || other.valuationCap.lt(cap))) {
        cap = other.valuationCap;
        mfnFrom = other.securityId;
      }
      if (other.discount && (!discount || other.discount.gt(discount))) {
        discount = other.discount;
        mfnFrom = mfnFrom ?? other.securityId;
      }
    }
    return { row, cap, discount, mfnFrom };
  });
}

/** One priced-round scenario over a cap table. */
export function roundScenario(rows: readonly CapTableRow[], round: PricedRound): RoundScenario {
  if (!round.preMoney.gt(0) || !round.amount.gt(0)) throw new RoundModelError('Pre-money and amount must be positive');
  if (round.poolTarget.lt(0) || round.poolTarget.gte(1)) throw new RoundModelError('The pool target must be at least 0% and below 100%');
  const held = outstanding(rows);
  const F = held.reduce((sum, row) => sum.plus(row.shares ?? ZERO), ZERO);
  if (!F.gt(0)) throw new RoundModelError('The cap table has no shares outstanding');
  const U = held.filter((row) => row.instrument === 'pool_unallocated').reduce((sum, row) => sum.plus(row.shares ?? ZERO), ZERO);
  const terms = effectiveTerms(rows);
  // k: converted shares per pre-money share; each instrument converts at the lower of cap ÷ y and P × (1 − d), with P = preMoney ÷ y.
  const k = terms.reduce((sum, { row, cap, discount }) => {
    const principal = row.principal ?? ZERO;
    const perShareAtCap = cap?.gt(0) ? new D(1).div(cap) : ZERO;
    const perShareAtDiscount = new D(1).div(round.preMoney.times(new D(1).minus(discount ?? ZERO)));
    return sum.plus(principal.times(D.max(perShareAtCap, perShareAtDiscount)));
  }, ZERO);
  const growth = new D(1).plus(round.amount.div(round.preMoney));

  const solve = (poolTarget: Dec) => {
    // y = pre-money share count. With a pool increase: y − F = t·y·growth − U + y·k; without one: y − F = y·k.
    const denominator = new D(1).minus(poolTarget.times(growth)).minus(k);
    let y = denominator.gt(0) ? F.minus(U).div(denominator) : new D(0);
    let increase = poolTarget.times(y).times(growth).minus(U);
    if (!denominator.gt(0) || increase.lt(0)) {
      increase = ZERO;
      const plain = new D(1).minus(k);
      if (!plain.gt(0)) throw new RoundModelError('The SAFE and note stack converts into more than the whole company at this pre-money');
      y = F.div(plain);
    }
    const price = round.preMoney.div(y);
    const conversions: Conversion[] = terms.map(({ row, cap, discount, mfnFrom }) => {
      const atCap = cap?.gt(0) ? cap.div(y) : null;
      const atDiscount = discount?.gt(0) ? price.times(new D(1).minus(discount)) : null;
      // The lowest price wins; a cap above the round price never makes a holder pay more than new money.
      const candidates = [
        ...(atCap ? [{ price: atCap, basis: 'CAP' as const }] : []),
        ...(atDiscount ? [{ price: atDiscount, basis: 'DISCOUNT' as const }] : []),
        { price, basis: 'ROUND_PRICE' as const },
      ];
      const best = candidates.sort((a, b) => a.price.comparedTo(b.price))[0] ?? { price, basis: 'ROUND_PRICE' as const };
      const principal = row.principal ?? ZERO;
      return {
        securityId: row.securityId,
        instrument: row.instrument as 'safe' | 'note',
        principal: principal.toFixed(2),
        price: best.price.toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toFixed(6),
        basis: best.basis,
        shares: principal.div(best.price).floor().toFixed(0),
        mfnFrom,
      };
    });
    const poolIncrease = increase.ceil();
    const converted = conversions.reduce((sum, entry) => sum.plus(entry.shares), ZERO);
    const newShares = round.amount.div(price).floor();
    const total = F.plus(poolIncrease).plus(converted).plus(newShares);
    return { y, price, conversions, poolIncrease, converted, newShares, total };
  };

  const withPool = solve(round.poolTarget);
  const withoutPool = solve(ZERO);
  const sharesOf = (type: HolderType) => held.filter((row) => row.holderType === type).reduce((sum, row) => sum.plus(row.shares ?? ZERO), ZERO);
  const convertedTo = (type: HolderType, scenario: typeof withPool) =>
    scenario.conversions.filter((entry) => rows.find((row) => row.securityId === entry.securityId)?.holderType === type).reduce((sum, entry) => sum.plus(entry.shares), ZERO);
  const types: HolderType[] = ['founder', 'employee', 'advisor', 'investor', 'pool'];
  const after = (type: HolderType, scenario: typeof withPool) => sharesOf(type).plus(convertedTo(type, scenario)).plus(type === 'pool' ? scenario.poolIncrease : ZERO);
  const founderAfter = after('founder', withPool);
  const pointsLost = founderAfter
    .div(withPool.total)
    .minus(after('founder', withoutPool).div(withoutPool.total))
    .times(-100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  return {
    preMoney: round.preMoney.toFixed(2),
    amount: round.amount.toFixed(2),
    postMoney: withPool.price.times(withPool.total).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2),
    pricePerShare: withPool.price.toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toFixed(6),
    sharesBefore: F.toFixed(0),
    poolIncrease: withPool.poolIncrease.toFixed(0),
    newInvestorShares: withPool.newShares.toFixed(0),
    sharesAfter: withPool.total.toFixed(0),
    conversions: withPool.conversions,
    ownership: [
      ...types.map((type) => ({ holderType: type, before: pct(sharesOf(type), F), after: pct(after(type, withPool), withPool.total) })),
      { holderType: 'new_investor' as const, before: '0.00', after: pct(withPool.newShares, withPool.total) },
    ],
    founders: { before: pct(sharesOf('founder'), F), after: pct(founderAfter, withPool.total) },
    poolShuffle: {
      shares: withPool.poolIncrease.toFixed(0),
      founderPointsLost: pointsLost.toFixed(2),
      statement: withPool.poolIncrease.gt(0)
        ? `The pool grows by ${withPool.poolIncrease.toFixed(0)} shares before the money comes in, so existing holders pay for it: founders end ${pointsLost.toFixed(2)} points lower than in the same round with no pool increase.`
        : 'The existing pool already meets the target; the round adds no pool shares.',
    },
    notes: [
      'Pre-money is fully diluted and includes the pool increase and converting SAFEs and notes.',
      'SAFEs and notes convert at the lower of the cap price and the discounted round price; note interest is not modelled.',
      'Mechanics only: whether a term is acceptable is the founder’s decision with counsel.',
    ],
  };
}

/** The same cap table across several priced-round pre-money values (at least two for a comparison). */
export function roundScenarios(rows: readonly CapTableRow[], round: Omit<PricedRound, 'preMoney'>, preMoneys: readonly Dec[]): RoundScenario[] {
  return preMoneys.map((preMoney) => roundScenario(rows, { ...round, preMoney }));
}

/** Plain-language consequence of a liquidation preference; 1x non-participating is the market baseline. */
export function liquidationPreference(multiple: Dec, participating: boolean): { readonly standard: boolean; readonly statement: string } {
  const standard = multiple.eq(1) && !participating;
  if (standard) return { standard, statement: '1x non-participating: on a sale the investor takes either its money back or its share of the proceeds, whichever is more.' };
  return {
    standard,
    statement: `${multiple.toString()}x ${participating ? 'participating' : 'non-participating'}: on a sale the investor first takes ${multiple.toString()}× its money${participating ? ' and then also shares in what is left' : ''} — more than the 1x non-participating baseline, so less reaches common holders in a modest exit.`,
  };
}
