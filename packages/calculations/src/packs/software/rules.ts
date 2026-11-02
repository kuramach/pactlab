import { D, parseDecimal } from '../../metrics/decimal';
import { addMonths, monthOf } from '../../metrics/months';
import { documentClauseRule, grouped, INVOICE_LINE, monthName, percent, revenueConcentrationRule } from '../common';
import { findMatch, findSentence, MAX_CITED, type PackRule, type PackRuleEvidence } from '../rule-types';

/**
 * Software and SaaS pack rules: the baseline pack's checks over the standard
 * billing import and the management documents. Deterministic and decimal-only;
 * they draft, a reviewer decides.
 */
type Decimal = InstanceType<typeof D>;
const INTERVAL_MONTHS: Readonly<Record<string, number>> = { month: 1, quarter: 3, year: 12 };
const nameOf = (row: PackRuleEvidence) => row.canonical['customer_name'] ?? row.canonical['customer_id'] ?? 'Unnamed';

/**
 * Monthly recurring revenue by customer and month, from invoice lines spread over their service period
 * (an annual line counts a twelfth in each month it covers). Null when the lines mix currencies.
 */
export function monthlyRevenue(evidence: readonly PackRuleEvidence[]) {
  const lines = evidence.filter((row) => row.evidenceType === INVOICE_LINE && /^\d{4}-\d{2}/.test(row.canonical['period_start'] ?? ''));
  const currencies = new Set(lines.map((row) => row.canonical['currency']));
  if (lines.length === 0 || currencies.size !== 1) return null;
  const byMonth = new Map<string, Map<string, { mrr: Decimal; rows: PackRuleEvidence[] }>>();
  for (const row of lines) {
    const amount = parseDecimal(row.canonical['amount']);
    const months = INTERVAL_MONTHS[row.canonical['interval'] ?? 'month'];
    const count = parseDecimal(row.canonical['interval_count'] ?? '1') ?? new D(1);
    if (!amount || !months || !count.gt(0)) continue;
    const span = count.times(months);
    const first = monthOf(row.canonical['period_start'] ?? '');
    for (let index = 0; span.gt(index); index += 1) {
      const month = addMonths(first, index);
      const customers = byMonth.get(month) ?? new Map<string, { mrr: Decimal; rows: PackRuleEvidence[] }>();
      const entry = customers.get(nameOf(row)) ?? { mrr: new D(0), rows: [] };
      entry.mrr = entry.mrr.plus(amount.div(span));
      entry.rows.push(row);
      customers.set(nameOf(row), entry);
      byMonth.set(month, customers);
    }
  }
  // The latest month a line was billed for (not the end of a prepaid period).
  const latest = lines.map((row) => monthOf(row.canonical['period_start'] ?? '')).sort().at(-1) ?? '';
  const months = [...byMonth.keys()].filter((month) => month <= latest).sort();
  const at = (month: string) => byMonth.get(month) ?? new Map<string, { mrr: Decimal; rows: PackRuleEvidence[] }>();
  const total = (month: string) => [...at(month).values()].reduce((sum, entry) => sum.plus(entry.mrr), new D(0));
  return { currency: [...currencies][0] ?? '', latest, months, at, total };
}

/** "Annual recurring revenue (ARR) at 30 September 2026: USD 656,112". */
const REPORTED_ARR = /\bARR\b[^:.]{0,60}:\s*([A-Z]{3})\s*([0-9][0-9,]*(?:\.[0-9]+)?)/;

/** Management reports more ARR than the billing supports (latest month's recurring revenue × 12). */
export const SAAS_REPORTED_ARR: PackRule = {
  id: 'saas-reported-arr',
  version: '1',
  evidenceTypes: [INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const revenue = monthlyRevenue(evidence);
    const found = findMatch(pages, REPORTED_ARR);
    if (!revenue || !found || found.match[1] !== revenue.currency) return [];
    const reported = parseDecimal((found.match[2] ?? '').replaceAll(',', ''));
    const billed = revenue.total(revenue.latest).times(12);
    if (!reported || !billed.gt(0)) return [];
    const gap = reported.minus(billed);
    const share = gap.div(billed);
    if (share.lt('0.02')) return [];
    // Customers billed in the last year but not in the latest month: often still counted by management.
    const current = revenue.at(revenue.latest);
    const year = revenue.months.filter((month) => month >= addMonths(revenue.latest, -11));
    const lapsed = [...new Set(year.flatMap((month) => [...revenue.at(month).keys()]))].filter((name) => !current.has(name)).sort();
    const lastBilled = (name: string) => year.filter((month) => revenue.at(month).has(name)).at(-1) ?? '';
    const { currency } = revenue;
    return [
      {
        key: revenue.latest,
        domain: 'FINANCIAL',
        title: 'Management ARR exceeds billed ARR',
        description:
          `Management reports ARR of ${currency} ${grouped(reported)}; billing supports ${currency} ${grouped(billed)} at ${monthName(revenue.latest)} ` +
          `(that month's recurring revenue × 12) — ${currency} ${grouped(gap)} (${percent(share)}) more than is billed.` +
          (lapsed.length ? ` Billed in the last year but not in ${monthName(revenue.latest)}: ${lapsed.map((name) => `${name}, last billed ${monthName(lastBilled(name))}`).join('; ')}.` : ''),
        severity: share.gte('0.05') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'An ARR multiple should rest on billed ARR; the reviewer prices the gap.',
        evidenceIds: [...[...current.values()].flatMap((entry) => entry.rows), ...lapsed.flatMap((name) => revenue.at(lastBilled(name)).get(name)?.rows ?? [])]
          .filter((row, index, all) => all.findIndex((other) => other.id === row.id) === index)
          .slice(0, MAX_CITED)
          .map((row) => row.id),
        quotes: [{ documentId: found.page.documentId, pageNumber: found.page.pageNumber, quote: found.quote }],
      },
    ];
  },
};

/** The largest customer's share of the latest month's revenue. */
export const SAAS_REVENUE_CONCENTRATION = revenueConcentrationRule({
  id: 'saas-revenue-concentration',
  title: 'Revenue concentration',
  domain: 'COMMERCIAL',
  threshold: '0.2',
  direction: 0,
  directionRationale: 'A customer-loss sensitivity in the scenarios, or a retention condition; not a price term by itself.',
  consequence: 'Losing that customer would take that share of recurring revenue with it.',
});

export const SAAS_CUSTOMER_CHANGE_OF_CONTROL = documentClauseRule({
  id: 'saas-customer-change-of-control',
  title: 'Customer can terminate on change of control',
  domain: 'LEGAL',
  severity: 'HIGH',
  direction: 0,
  directionRationale: 'A closing condition (the customer’s consent or a waiver), not a price adjustment.',
  sentences: [(sentence) => /change of control/i.test(sentence) && /terminat/i.test(sentence) && /customer/i.test(sentence)],
  description: ([clause]) => `A customer contract lets the customer leave if the company is sold: “${clause}”`,
});

/** "Logo count: 14 active customers". */
const LOGO_COUNT = /([0-9][0-9,]*)\s+active customers/i;

/** Customers still billed but paying well below their earlier level, while management reports a flat logo count. */
export const SAAS_HIDDEN_CONTRACTION: PackRule = {
  id: 'saas-hidden-contraction',
  version: '1',
  evidenceTypes: [INVOICE_LINE],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const revenue = monthlyRevenue(evidence);
    const hit = findSentence(pages, (sentence) => LOGO_COUNT.test(sentence));
    const reported = hit ? parseDecimal((LOGO_COUNT.exec(hit.quote)?.[1] ?? '').replaceAll(',', '')) : null;
    if (!revenue || !hit || !reported) return [];
    const current = revenue.at(revenue.latest);
    const year = revenue.months.filter((month) => month >= addMonths(revenue.latest, -11) && month < revenue.latest);
    // A customer contracted when the latest month is at least 20% below its highest month in the last year.
    const contracted = [...current.entries()]
      .map(([name, entry]) => {
        const peakMonth = year.reduce<string | null>((best, month) => ((revenue.at(month).get(name)?.mrr ?? new D(0)).gt(best ? (revenue.at(best).get(name)?.mrr ?? 0) : 0) ? month : best), null);
        const peak = peakMonth ? (revenue.at(peakMonth).get(name)?.mrr ?? new D(0)) : new D(0);
        const since = peakMonth ? (year.find((month) => month > peakMonth && (revenue.at(month).get(name)?.mrr ?? new D(0)).lt(peak)) ?? revenue.latest) : revenue.latest;
        return { name, entry, peak, since, drop: peak.gt(0) ? peak.minus(entry.mrr).div(peak) : new D(0) };
      })
      .filter((customer) => customer.drop.gte('0.2'))
      .sort((a, b) => b.drop.comparedTo(a.drop) || a.name.localeCompare(b.name));
    if (contracted.length === 0) return [];
    const { currency } = revenue;
    return [
      {
        key: revenue.latest,
        domain: 'COMMERCIAL',
        title: 'Contraction hidden in the logo count',
        description:
          contracted.map((customer) => `${customer.name} pays ${currency} ${grouped(customer.entry.mrr)} a month in ${monthName(revenue.latest)}, ${percent(customer.drop)} below ${currency} ${grouped(customer.peak)} before ${monthName(customer.since)}`).join('; ') +
          `. Management reports ${grouped(reported)} active customers; billing has ${current.size} in ${monthName(revenue.latest)}. A logo count does not show customers who stay but pay less.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Retention and growth assumptions should follow billed revenue per customer, not the logo count.',
        evidenceIds: contracted.flatMap((customer) => customer.entry.rows).slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: hit.page.documentId, pageNumber: hit.page.pageNumber, quote: hit.quote }],
      },
    ];
  },
};

export const SOFTWARE_RULES: readonly PackRule[] = [SAAS_REPORTED_ARR, SAAS_REVENUE_CONCENTRATION, SAAS_CUSTOMER_CHANGE_OF_CONTROL, SAAS_HIDDEN_CONTRACTION];
