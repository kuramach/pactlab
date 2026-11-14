import { Money } from '../money';

/**
 * Buyer financing (T-117, ADR 0033): how the buyer funds the deal, as the buyer attests it.
 * Deterministic and decimal: coverage, the deal-certainty posture and the gaps that block.
 * Financing is about certainty of close, never price: nothing here feeds valuation or terms.
 */
export const TRANCHE_KINDS = ['CASH', 'SBA_7A', 'CONVENTIONAL_DEBT', 'SELLER_NOTE', 'ROLLOVER_EQUITY', 'OTHER'] as const;
export type TrancheKind = (typeof TRANCHE_KINDS)[number];

/** The ladder each tranche climbs; order matters. */
export const TRANCHE_STATUSES = ['NOT_STARTED', 'EXPLORING', 'PRE_QUALIFIED', 'APPLICATION_SUBMITTED', 'COMMITMENT_ISSUED', 'CLEARED_TO_CLOSE'] as const;
export type TrancheStatus = (typeof TRANCHE_STATUSES)[number];

export const ESCROW_STATUSES = ['NOT_COMMITTED', 'COMMITTED', 'DEPOSITED', 'APPLIED_AT_CLOSE', 'RELEASED_TO_SELLER', 'REFUNDED_TO_BUYER'] as const;
export type EscrowStatus = (typeof ESCROW_STATUSES)[number];
/** Where the deposit ends: applied against the price at close, kept by the seller, or returned. */
export const ESCROW_DISPOSITIONS = ['APPLIED_AT_CLOSE', 'RELEASED_TO_SELLER', 'REFUNDED_TO_BUYER'] as const;

export const TRANCHE_KIND_LABELS: Readonly<Record<TrancheKind, string>> = {
  CASH: 'Cash',
  SBA_7A: 'SBA 7(a) loan',
  CONVENTIONAL_DEBT: 'Conventional debt',
  SELLER_NOTE: 'Seller note',
  ROLLOVER_EQUITY: 'Rollover equity',
  OTHER: 'Other',
};
export const TRANCHE_STATUS_LABELS: Readonly<Record<TrancheStatus, string>> = {
  NOT_STARTED: 'Not started',
  EXPLORING: 'Exploring',
  PRE_QUALIFIED: 'Pre-qualified',
  APPLICATION_SUBMITTED: 'Application submitted',
  COMMITMENT_ISSUED: 'Commitment issued',
  CLEARED_TO_CLOSE: 'Cleared to close',
};

export const rank = (status: TrancheStatus) => TRANCHE_STATUSES.indexOf(status);
/** From pre-qualification up, a status should be backed by a document (a letter, proof of funds). */
export const needsDocument = (status: TrancheStatus) => rank(status) >= rank('PRE_QUALIFIED');
/** Committed money: a lender's commitment or better. Cash and equity count once proven (pre-qualified up). */
const firm = (tranche: Pick<FinancingTranche, 'kind' | 'status'>) =>
  tranche.kind === 'CASH' || tranche.kind === 'ROLLOVER_EQUITY' || tranche.kind === 'SELLER_NOTE' ? rank(tranche.status) >= rank('PRE_QUALIFIED') : rank(tranche.status) >= rank('COMMITMENT_ISSUED');
const isDebt = (kind: TrancheKind) => kind === 'SBA_7A' || kind === 'CONVENTIONAL_DEBT';

export interface FinancingTranche {
  kind: TrancheKind;
  amount: string;
  currency: string;
  status: TrancheStatus;
  /** A document the reader may see backs this tranche. */
  documented: boolean;
}

export interface FinancingEscrow {
  amount: string;
  currency: string;
  status: EscrowStatus;
  depositDueOn: string | null;
  hardOn: string | null;
  /** The seller confirmed the deposit (or a disposition is recorded). */
  confirmed: boolean;
}

export interface FinancingInput {
  tranches: readonly FinancingTranche[];
  escrow: FinancingEscrow | null;
  commitmentExpectedBy: string | null;
  /** The price the plan must cover: the agreed headline price, else the latest proposed one. */
  price: { amount: string; currency: string; agreed: boolean } | null;
  /** UTC date, YYYY-MM-DD. */
  today: string;
}

export interface Coverage {
  total: string;
  firm: string;
  currency: string;
  /** UNDER: the plan does not reach the price; OVER: it exceeds it; null without a price. */
  against: { price: string; agreed: boolean; state: 'UNDER' | 'EXACT' | 'OVER'; gap: string } | null;
  /** Tranches in another currency than the price are not summed; they are listed. */
  otherCurrencies: readonly string[];
}

export type PostureLevel = 'NONE' | 'EARLY' | 'IN_PROGRESS' | 'COMMITTED' | 'CLEARED';

export interface FinancingPosture {
  level: PostureLevel;
  /** One plain line for the seller, e.g. "Commitment issued — USD 6,000,000.00 of USD 8,000,000.00 covered". */
  headline: string;
  escrow: string | null;
  coverage: Coverage;
  /** Gaps that block close, each a sentence. */
  blockers: readonly string[];
}

export function formatAmount(amount: string, currency: string): string {
  const [whole = '0', fraction = ''] = amount.replace('-', '').split('.');
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(fraction + '00').slice(0, 2)}`;
}

export function coverage(input: Pick<FinancingInput, 'tranches' | 'price'>): Coverage {
  const currency = input.price?.currency ?? input.tranches[0]?.currency ?? 'USD';
  const same = input.tranches.filter((tranche) => tranche.currency === currency);
  const total = same.reduce((sum, tranche) => sum.add(Money.of(tranche.amount, currency)), Money.zero(currency));
  const firmTotal = same.filter(firm).reduce((sum, tranche) => sum.add(Money.of(tranche.amount, currency)), Money.zero(currency));
  let against: Coverage['against'] = null;
  if (input.price) {
    const price = Money.of(input.price.amount, currency);
    const order = total.compare(price);
    against = { price: price.toFixed(), agreed: input.price.agreed, state: order < 0 ? 'UNDER' : order === 0 ? 'EXACT' : 'OVER', gap: (order < 0 ? price.subtract(total) : total.subtract(price)).toFixed() };
  }
  return { total: total.toFixed(), firm: firmTotal.toFixed(), currency, against, otherCurrencies: [...new Set(input.tranches.filter((tranche) => tranche.currency !== currency).map((tranche) => tranche.currency))] };
}

/** The deal-certainty signal and the gaps that block close. Buyer-provided figures throughout. */
export function financingPosture(input: FinancingInput): FinancingPosture {
  const cover = coverage(input);
  const money = (amount: string) => formatAmount(amount, cover.currency);
  const blockers: string[] = [];
  let level: PostureLevel;
  let headline: string;
  if (input.tranches.length === 0) {
    level = 'NONE';
    headline = 'No financing shared yet';
  } else {
    const best = Math.max(...input.tranches.map((tranche) => rank(tranche.status)));
    const reach = cover.against ? ` of ${money(cover.against.price)}` : '';
    const allCleared = input.tranches.every((tranche) => tranche.status === 'CLEARED_TO_CLOSE');
    const firmCovers = cover.against ? Money.of(cover.firm, cover.currency).compare(Money.of(cover.against.price, cover.currency)) >= 0 : false;
    if (allCleared && (cover.against?.state ?? 'EXACT') !== 'UNDER') {
      level = 'CLEARED';
      headline = `Cleared to close — ${money(cover.total)}${reach} covered`;
    } else if (firmCovers) {
      level = 'COMMITTED';
      headline = `Commitment issued — ${money(cover.firm)}${reach} covered`;
    } else if (best <= rank('EXPLORING')) {
      level = 'EARLY';
      headline = input.tranches.some((tranche) => isDebt(tranche.kind)) ? 'No lender engaged yet' : 'Financing being arranged';
    } else {
      level = 'IN_PROGRESS';
      headline = `In progress — ${money(cover.firm)}${reach} committed so far`;
    }
  }
  if (cover.against?.state === 'UNDER' && input.tranches.length > 0) blockers.push(`Financing covers ${money(cover.total)} of the ${cover.against.agreed ? 'agreed' : 'proposed'} price of ${money(cover.against.price)}.`);
  const debt = input.tranches.filter((tranche) => isDebt(tranche.kind));
  if (input.commitmentExpectedBy && input.commitmentExpectedBy < input.today && debt.some((tranche) => rank(tranche.status) < rank('COMMITMENT_ISSUED'))) {
    blockers.push(`A lender commitment was expected by ${input.commitmentExpectedBy} and has not been issued.`);
  }
  let escrow: string | null = null;
  const deposit = input.escrow;
  if (deposit && deposit.status !== 'NOT_COMMITTED') {
    const amount = formatAmount(deposit.amount, deposit.currency);
    escrow =
      deposit.status === 'COMMITTED'
        ? `Earnest ${amount} committed${deposit.depositDueOn ? `, due by ${deposit.depositDueOn}` : ''}`
        : deposit.status === 'DEPOSITED'
          ? `Earnest ${amount} deposited${deposit.confirmed ? '' : ' (awaiting the seller’s confirmation)'}${deposit.hardOn ? `, ${deposit.hardOn < input.today || deposit.hardOn === input.today ? 'hard since' : 'hard after'} ${deposit.hardOn}` : ''}`
          : deposit.status === 'APPLIED_AT_CLOSE'
            ? `Earnest ${amount} applied against the price at close`
            : deposit.status === 'RELEASED_TO_SELLER'
              ? `Earnest ${amount} released to the seller`
              : `Earnest ${amount} refunded to the buyer`;
    if (deposit.status === 'COMMITTED' && deposit.depositDueOn && deposit.depositDueOn < input.today) blockers.push(`The earnest deposit of ${amount} was due by ${deposit.depositDueOn} and is not recorded.`);
  }
  return { level, headline, escrow, coverage: cover, blockers };
}
