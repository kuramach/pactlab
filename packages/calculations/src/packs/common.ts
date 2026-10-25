import { D, parseDecimal } from '../metrics/decimal';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence, type PackRulePage, type PackRuleProposal, type PackRuleQuote } from './rule-types';

/**
 * Rule factories shared by the industry packs (T-061 onward). Two shapes
 * recur across sectors: one counterparty (or a named group of them) carrying
 * too much of the latest month's revenue, and a document clause that changes
 * the deal. Both are deterministic, decimal-only and cite their sources.
 */
export const INVOICE_LINE = 'billing.invoice_line';

type Decimal = InstanceType<typeof D>;
export const percent = (value: Decimal) => `${value.times(100).toFixed(1)}%`;
export const grouped = (value: Decimal) => value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const amountOf = (row: PackRuleEvidence, field: string) => parseDecimal(row.canonical[field]) ?? new D(0);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-09" → "September 2026". */
export const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;

/** The month a row belongs to (`YYYY-MM`), from the first date field present. */
export function rowMonth(row: PackRuleEvidence, fields: readonly string[] = ['period_start', 'created']): string | null {
  for (const field of fields) {
    const value = row.canonical[field];
    if (value && /^\d{4}-\d{2}/.test(value)) return value.slice(0, 7);
  }
  return null;
}

const counterpartyOf = (row: PackRuleEvidence) => row.canonical['customer_name'] ?? row.canonical['customer_id'] ?? 'Unnamed';

/**
 * The latest month's revenue by counterparty over the billing import: the
 * month, its single currency and total, and each counterparty's revenue and
 * lines. Null when there is no dated revenue or the month mixes currencies.
 */
export function latestMonthRevenue(evidence: readonly PackRuleEvidence[]) {
  const lines = evidence.filter((row) => row.evidenceType === INVOICE_LINE && rowMonth(row));
  if (lines.length === 0) return null;
  const month = lines.map((row) => rowMonth(row) as string).sort().at(-1) as string;
  const inMonth = lines.filter((row) => rowMonth(row) === month);
  const currencies = new Set(inMonth.map((row) => row.canonical['currency']));
  if (currencies.size !== 1) return null;
  const total = inMonth.reduce((sum, row) => sum.plus(amountOf(row, 'amount')), new D(0));
  if (!total.gt(0)) return null;
  const byName = new Map<string, Decimal>();
  for (const row of inMonth) byName.set(counterpartyOf(row), (byName.get(counterpartyOf(row)) ?? new D(0)).plus(amountOf(row, 'amount')));
  const ranked = [...byName.entries()].sort((a, b) => b[1].comparedTo(a[1]) || a[0].localeCompare(b[0]));
  return { month, currency: [...currencies][0] ?? '', total, byName, ranked, lines: inMonth, linesOf: (names: readonly string[]) => inMonth.filter((row) => names.includes(counterpartyOf(row))) };
}

export interface ConcentrationConfig {
  readonly id: string;
  readonly version?: string;
  readonly title: string;
  readonly domain: PackRuleProposal['domain'];
  /** Share of the month's revenue at or above which the finding is drafted (decimal string). */
  readonly threshold: string;
  /** A named group (e.g. government programmes); otherwise the single largest counterparty. */
  readonly group?: { readonly match: RegExp; readonly label: string };
  /** Group counterparties by a key read from the name (e.g. a region) and take the largest group. */
  readonly groupBy?: { readonly key: (name: string) => string | null; readonly label: (key: string) => string };
  readonly direction: -1 | 0 | 1;
  readonly directionRationale: string;
  readonly severity?: PackRuleProposal['severity'];
  /** Extra sentence after the measured share. */
  readonly consequence?: string;
}

/**
 * Revenue concentration over the standard billing import: the latest month's
 * revenue by customer name; drafts when one counterparty (or the group) is at
 * or above the threshold. Cites that month's lines for the counterparty.
 */
export function revenueConcentrationRule(config: ConcentrationConfig): PackRule {
  return {
    id: config.id,
    version: config.version ?? '1',
    evidenceTypes: [INVOICE_LINE],
    detect: ({ evidence }) => {
      const revenue = latestMonthRevenue(evidence);
      if (!revenue) return [];
      const { month: latest, currency, total, byName } = revenue;
      const largest = (totals: Map<string, Decimal>) => [...totals.entries()].sort((a, b) => b[1].comparedTo(a[1]) || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
      let chosen: string[];
      let label: string;
      if (config.group) {
        chosen = [...byName.keys()].filter((name) => config.group?.match.test(name));
        label = config.group.label;
      } else if (config.groupBy) {
        const byGroup = new Map<string, Decimal>();
        for (const [name, amount] of byName) {
          const key = config.groupBy.key(name);
          if (key) byGroup.set(key, (byGroup.get(key) ?? new D(0)).plus(amount));
        }
        const top = largest(byGroup);
        chosen = top ? revenue.ranked.map(([name]) => name).filter((name) => config.groupBy?.key(name) === top) : [];
        label = top ? config.groupBy.label(top) : '';
      } else {
        chosen = [largest(byName)].filter((name) => name !== '');
        label = chosen[0] ?? '';
      }
      if (chosen.length === 0) return [];
      const share = chosen.reduce((sum, name) => sum.plus(byName.get(name) ?? 0), new D(0)).div(total);
      if (share.lt(config.threshold)) return [];
      const cited = revenue.linesOf(chosen);
      // A group of several lines also names its largest, which is often the exposure by itself.
      const [first] = chosen;
      const largestLine = config.groupBy && chosen.length > 1 && first ? ` Its largest line, ${first}, is ${percent((byName.get(first) ?? new D(0)).div(total))}.` : '';
      return [
        {
          key: `${latest}:${label}`,
          domain: config.domain,
          title: config.title,
          description: `${label} ${chosen.length > 1 && !config.groupBy ? 'are' : 'is'} ${percent(share)} of ${monthName(latest)} revenue (${currency} ${grouped(total)} in the month).${largestLine}${config.consequence ? ` ${config.consequence}` : ''}`,
          severity: config.severity ?? (share.gte('0.5') ? 'HIGH' : 'MEDIUM'),
          confidence: 'HIGH',
          direction: config.direction,
          directionRationale: config.directionRationale,
          evidenceIds: cited.slice(0, MAX_CITED).map((row) => row.id),
        },
      ];
    },
  };
}

export interface ClauseConfig {
  readonly id: string;
  readonly version?: string;
  readonly title: string;
  readonly domain: PackRuleProposal['domain'];
  readonly severity: PackRuleProposal['severity'];
  readonly direction: -1 | 0 | 1;
  readonly directionRationale?: string;
  /** Every test must find a sentence (on any readable page); each found sentence is cited. */
  readonly sentences: readonly ((sentence: string) => boolean)[];
  readonly description: (quotes: readonly string[]) => string;
  /** Price the finding from an amount in the first quote ("USD 3,600,000"). */
  readonly price?: { readonly type: NonNullable<PackRuleProposal['pricedRisk']>['type']; readonly lowShare?: string; readonly basis: string };
}

const MONEY_IN_TEXT = /\b([A-Z]{3})\s*([0-9][0-9,]*(?:\.[0-9]+)?)/;

/** The money amount stated in a sentence, e.g. "USD 3,600,000" → { USD, 3600000 }. */
export function moneyIn(text: string): { currency: string; amount: Decimal } | null {
  const match = MONEY_IN_TEXT.exec(text);
  const amount = match ? parseDecimal((match[2] ?? '').replaceAll(',', '')) : null;
  return match && amount ? { currency: match[1] ?? '', amount } : null;
}

/** A document clause that changes the deal, cited exactly; optionally priced from the amount it states. */
export function documentClauseRule(config: ClauseConfig): PackRule {
  return {
    id: config.id,
    version: config.version ?? '1',
    evidenceTypes: [],
    readsDocuments: true,
    detect: ({ pages }) => {
      const found: { page: PackRulePage; quote: string }[] = [];
      for (const test of config.sentences) {
        const hit = findSentence(pages, test);
        if (!hit) return [];
        found.push(hit);
      }
      const quotes: PackRuleQuote[] = found.map(({ page, quote }) => ({ documentId: page.documentId, pageNumber: page.pageNumber, quote }));
      const money = config.price ? moneyIn(found[0]?.quote ?? '') : null;
      if (config.price && !money) return [];
      return [
        {
          key: `${found[0]?.page.documentId}:${found[0]?.page.pageNumber}`,
          domain: config.domain,
          title: config.title,
          description: config.description(found.map((hit) => hit.quote)),
          severity: config.severity,
          confidence: 'HIGH',
          direction: config.direction,
          directionRationale: config.directionRationale ?? null,
          pricedRisk:
            config.price && money
              ? { type: config.price.type, currency: money.currency, low: money.amount.times(config.price.lowShare ?? '1').toFixed(2), high: money.amount.toFixed(2), basis: config.price.basis }
              : null,
          evidenceIds: [],
          quotes,
        },
      ];
    },
  };
}
