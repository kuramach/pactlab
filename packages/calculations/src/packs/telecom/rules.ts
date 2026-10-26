import { D, parseDecimal } from '../../metrics/decimal';
import { amountOf, documentClauseRule, grouped, monthName, percent, revenueConcentrationRule } from '../common';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence } from '../rule-types';

/**
 * Telecom and media pack rules (T-062, spec §19). Subscriber counts come from
 * the billing extract; reported figures come from management documents.
 */
const SUBSCRIBERS = 'telecom.subscribers_month';
type Decimal = InstanceType<typeof D>;

/** Billed subscribers per month, oldest first, with the rows behind each total. */
function monthlyTotals(evidence: readonly PackRuleEvidence[]) {
  const months = new Map<string, { total: Decimal; rows: PackRuleEvidence[] }>();
  for (const row of evidence) {
    const month = row.evidenceType === SUBSCRIBERS ? row.canonical['month'] : null;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) continue;
    const entry = months.get(month) ?? { total: new D(0), rows: [] };
    entry.total = entry.total.plus(amountOf(row, 'billed_subscribers'));
    entry.rows.push(row);
    months.set(month, entry);
  }
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, entry]) => ({ month, ...entry }));
}

const REPORTED = /subscribers at [^:]*:\s*([0-9][0-9,]*)/i;
const REPORTED_CHURN = /churn[^:]*:\s*([0-9]+(?:\.[0-9]+)?)%/i;

/** Management reports more subscribers than the billing extract bills in the same month. */
export const TELECOM_REPORTED_SUBSCRIBERS: PackRule = {
  id: 'telecom-reported-subscribers',
  version: '1',
  evidenceTypes: [SUBSCRIBERS],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const latest = monthlyTotals(evidence).at(-1);
    const hit = findSentence(pages, (sentence) => REPORTED.test(sentence));
    const reported = hit ? parseDecimal((REPORTED.exec(hit.quote)?.[1] ?? '').replaceAll(',', '')) : null;
    if (!latest || !hit || !reported || !latest.total.gt(0)) return [];
    const gap = reported.minus(latest.total);
    const share = gap.div(latest.total);
    if (share.lt('0.02')) return [];
    return [
      {
        key: latest.month,
        domain: 'FINANCIAL',
        title: 'Reported subscribers exceed billed subscribers',
        description: `Management reports ${grouped(reported)} subscribers; the billing extract bills ${grouped(latest.total)} in ${monthName(latest.month)} — ${grouped(gap)} (${percent(share)}) more than are billed.`,
        severity: share.gte('0.05') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Revenue and the valuation should rest on billed subscribers; the reviewer prices the gap.',
        evidenceIds: latest.rows.slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: hit.page.documentId, pageNumber: hit.page.pageNumber, quote: hit.quote }],
      },
    ];
  },
};

/** Billed subscribers grew to a peak and have fallen every month since. */
export const TELECOM_CHURN_TURNING: PackRule = {
  id: 'telecom-churn-turning',
  version: '1',
  evidenceTypes: [SUBSCRIBERS],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const months = monthlyTotals(evidence);
    if (months.length < 6) return [];
    const peakIndex = months.reduce((best, month, index) => (month.total.gt(months[best]?.total ?? 0) ? index : best), 0);
    const first = months[0];
    const peak = months[peakIndex];
    const latest = months.at(-1);
    const after = months.slice(peakIndex);
    // At least three months of decline, each below the one before, after real growth.
    if (!first || !peak || !latest || peakIndex === 0 || after.length < 4 || !after.every((month, index) => index === 0 || month.total.lt(after[index - 1]?.total ?? 0))) return [];
    const growth = peak.total.minus(first.total).div(first.total).div(peakIndex);
    const decline = peak.total.minus(latest.total).div(peak.total).div(after.length - 1);
    if (!growth.gt(0)) return [];
    // The finding is the contrast with the reported rate, so it waits for the document that states it.
    const churn = findSentence(pages, (sentence) => REPORTED_CHURN.test(sentence));
    if (!churn) return [];
    return [
      {
        key: peak.month,
        domain: 'COMMERCIAL',
        title: 'Churn rising against the reported rate',
        description: `Billed subscribers grew about ${percent(growth)} a month to ${grouped(peak.total)} in ${monthName(peak.month)}, then fell about ${percent(decline)} a month to ${grouped(latest.total)} in ${monthName(latest.month)}. Management still reports ${REPORTED_CHURN.exec(churn.quote)?.[1]}% monthly churn.`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Churn and growth assumptions in the scenarios should follow billed subscribers, not the reported rate.',
        evidenceIds: [...peak.rows, ...latest.rows].slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: churn.page.documentId, pageNumber: churn.page.pageNumber, quote: churn.quote }],
      },
    ];
  },
};

/** The largest region's share of the latest month's revenue (customer names read "<Region> region — <plan>"). */
export const TELECOM_REGIONAL_CONCENTRATION = revenueConcentrationRule({
  id: 'telecom-regional-concentration',
  title: 'Regional concentration',
  domain: 'COMMERCIAL',
  threshold: '0.4',
  groupBy: { key: (name) => /^(.+? region)\b/i.exec(name)?.[1] ?? null, label: (region) => `The ${region}` },
  direction: 0,
  directionRationale: 'A regional build-out or competition sensitivity in the scenarios, not a price term.',
  consequence: 'A competitor building into that region moves a large share of revenue.',
});

export const TELECOM_WHOLESALE_REVIEW = documentClauseRule({
  id: 'telecom-wholesale-review',
  title: 'Wholesale price review ahead',
  domain: 'COMMERCIAL',
  severity: 'MEDIUM',
  direction: -1,
  directionRationale: 'Network access cost may rise at the review; the reviewer prices the exposure.',
  sentences: [(sentence) => /re-?priced|pricing review/i.test(sentence) && /next review/i.test(sentence)],
  description: ([clause]) => `The wholesale network agreement re-prices access charges before the forecast ends: “${clause}”`,
});

export const TELECOM_RULES: readonly PackRule[] = [TELECOM_REPORTED_SUBSCRIBERS, TELECOM_CHURN_TURNING, TELECOM_REGIONAL_CONCENTRATION, TELECOM_WHOLESALE_REVIEW];
export const TELECOM_EVIDENCE = { SUBSCRIBERS } as const;
