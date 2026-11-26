import Decimal from 'decimal.js';
import { D } from '../../metrics/decimal';
import { effectiveTerms, type CapTableRow } from '../../venture/round';
import type { RoundStatement } from './documents';

/**
 * Startup equity SPV round math (T-141, `spv-round-check-1`): the round the summary states,
 * recomputed from the startup's cap table. Deterministic and decimal-only; documents only.
 *
 * Conventions (returned with every result):
 * - The round price is the one the round summary states. Pre-round shares are every outstanding
 *   share and option in the cap table, including the unallocated pool; SAFEs and notes are not.
 * - Each SAFE or note converts at the lowest of its cap price (cap ÷ pre-round shares), the round
 *   price less its discount, and the round price. An MFN instrument takes the best cap and discount
 *   of any instrument issued after it. Note interest is not modelled. Conversion shares round down.
 * - Post-round fully diluted shares = pre-round shares + conversion shares + new shares.
 */
export const SPV_ROUND_CHECK_VERSION = 'spv-round-check-1';
type Dec = InstanceType<typeof D>;

export interface SpvConversion {
  readonly securityId: string;
  readonly instrument: 'safe' | 'note';
  readonly principal: string;
  readonly cap: string | null;
  readonly discount: string | null;
  readonly mfnFrom: string | null;
  readonly price: string;
  readonly basis: 'CAP' | 'DISCOUNT' | 'ROUND_PRICE';
  readonly shares: string;
  readonly proRata: boolean;
}

export interface SpvRoundCheck {
  readonly version: string;
  readonly currency: string | null;
  readonly preRoundShares: string;
  readonly pricePerShare: string | null;
  readonly conversions: readonly SpvConversion[];
  readonly conversionShares: string;
  readonly newShares: string | null;
  /** Round size recomputed as new shares × price, against the stated round size. */
  readonly roundSize: { readonly stated: string | null; readonly recomputed: string | null; readonly ties: boolean | null };
  /** Pre-money recomputed as price × pre-round shares, against the stated pre-money. */
  readonly preMoney: { readonly stated: string | null; readonly recomputed: string | null; readonly ties: boolean | null };
  readonly postRoundShares: { readonly stated: string | null; readonly recomputed: string | null; readonly difference: string | null; readonly ties: boolean | null };
  /** When the post-round difference is exactly what some converting instruments convert into. */
  readonly explainedBy: readonly string[] | null;
  readonly postMoney: string | null;
  /** Instruments with a pro-rata right, recorded per instrument (from the cap table). */
  readonly proRata: readonly { readonly securityId: string; readonly holderRef: string; readonly instrument: string }[];
  readonly conventions: readonly string[];
}

const CONVENTIONS = [
  'The round price is the one the round summary states; pre-round shares are every outstanding share and option in the cap table, including the unallocated pool.',
  'Each SAFE or note converts at the lowest of its cap price (cap ÷ pre-round shares), the round price less its discount, and the round price; an MFN instrument takes the best later cap and discount; note interest is not modelled; conversion shares round down.',
  'Post-round fully diluted shares = pre-round shares + conversion shares + new shares.',
] as const;
const isConverting = (row: CapTableRow) => row.instrument === 'safe' || row.instrument === 'note';
const plain = (value: Dec | null | undefined) => (value ? value.toFixed() : null);

/** Every non-empty subset of up to 12 conversions whose shares sum to `difference` (the smallest first). */
function explaining(conversions: readonly SpvConversion[], difference: Dec): string[] | null {
  if (!difference.gt(0) || conversions.length === 0 || conversions.length > 12) return null;
  const total = conversions.length;
  let best: string[] | null = null;
  for (let mask = 1; mask < 1 << total; mask += 1) {
    const chosen = conversions.filter((_, index) => mask & (1 << index));
    const sum = chosen.reduce((acc, entry) => acc.plus(entry.shares), new D(0));
    if (sum.eq(difference) && (!best || chosen.length < best.length)) best = chosen.map((entry) => entry.securityId);
  }
  return best;
}

export function spvRoundCheck(rows: readonly CapTableRow[], round: RoundStatement, proRataOf: (securityId: string) => boolean): SpvRoundCheck {
  const held = rows.filter((row) => !isConverting(row));
  const preRound = held.reduce((sum, row) => sum.plus(row.shares ?? 0), new D(0));
  const price = round.pricePerShare?.value.amount ?? null;
  const currency = round.pricePerShare?.value.currency ?? round.roundSize?.value.currency ?? round.preMoney?.value.currency ?? null;
  const conversions: SpvConversion[] =
    price && price.gt(0) && preRound.gt(0)
      ? effectiveTerms(rows).map(({ row, cap, discount, mfnFrom }) => {
          const candidates = [
            ...(cap?.gt(0) ? [{ price: cap.div(preRound), basis: 'CAP' as const }] : []),
            ...(discount?.gt(0) ? [{ price: price.times(new D(1).minus(discount)), basis: 'DISCOUNT' as const }] : []),
            { price, basis: 'ROUND_PRICE' as const },
          ].sort((a, b) => a.price.comparedTo(b.price));
          const best = candidates[0] ?? { price, basis: 'ROUND_PRICE' as const };
          const principal = row.principal ?? new D(0);
          return {
            securityId: row.securityId,
            instrument: row.instrument as 'safe' | 'note',
            principal: principal.toFixed(2),
            cap: plain(cap),
            discount: plain(discount),
            mfnFrom,
            price: best.price.toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toFixed(6),
            basis: best.basis,
            shares: principal.div(best.price).floor().toFixed(0),
            proRata: proRataOf(row.securityId),
          };
        })
      : [];
  const conversionShares = conversions.reduce((sum, entry) => sum.plus(entry.shares), new D(0));
  const newShares = round.newShares?.value ?? null;
  const recomputedSize = newShares && price ? newShares.times(price) : null;
  const statedSize = round.roundSize?.value.amount ?? null;
  // Within one share's price: the summary may round the size; anything more is arithmetic that does not hold.
  const sizeTies = recomputedSize && statedSize && price ? recomputedSize.minus(statedSize).abs().lt(price) : null;
  const recomputedPre = price ? price.times(preRound) : null;
  const statedPre = round.preMoney?.value.amount ?? null;
  const preTies = recomputedPre && statedPre && price ? recomputedPre.minus(statedPre).abs().lt(price) : null;
  const recomputedPost = newShares && price ? preRound.plus(conversionShares).plus(newShares) : null;
  const statedPost = round.postRoundShares?.value ?? null;
  const difference = recomputedPost && statedPost ? recomputedPost.minus(statedPost) : null;
  return {
    version: SPV_ROUND_CHECK_VERSION,
    currency,
    preRoundShares: preRound.toFixed(0),
    pricePerShare: price ? price.toFixed() : null,
    conversions,
    conversionShares: conversionShares.toFixed(0),
    newShares: plain(newShares),
    roundSize: { stated: plain(statedSize), recomputed: recomputedSize ? recomputedSize.toFixed(2) : null, ties: sizeTies },
    preMoney: { stated: plain(statedPre), recomputed: recomputedPre ? recomputedPre.toFixed(2) : null, ties: preTies },
    postRoundShares: { stated: plain(statedPost), recomputed: recomputedPost ? recomputedPost.toFixed(0) : null, difference: difference ? difference.toFixed(0) : null, ties: difference ? difference.eq(0) : null },
    explainedBy: difference ? explaining(conversions, difference) : null,
    postMoney: recomputedPost && price ? recomputedPost.times(price).toFixed(2) : null,
    proRata: rows.filter((row) => proRataOf(row.securityId)).map((row) => ({ securityId: row.securityId, holderRef: row.holderRef, instrument: row.instrument })),
    conventions: CONVENTIONS,
  };
}
