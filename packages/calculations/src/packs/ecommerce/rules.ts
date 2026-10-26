import { D } from '../../metrics/decimal';
import { amountOf, latestMonthRevenue, monthName, percent } from '../common';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence } from '../rule-types';

/**
 * E-commerce and DTC pack rules (T-065, spec §19). Cohorts and channels are
 * counts and amounts; no customer is ever identified.
 */
const COHORT = 'ecommerce.cohort_month';
const AD_SPEND = 'ecommerce.ad_spend_month';
type Decimal = InstanceType<typeof D>;

/** A marketplace carries most of the latest month's revenue, and its seller terms let it change fees or delist on notice. */
export const ECOMMERCE_MARKETPLACE_MAJORITY: PackRule = {
  id: 'ecommerce-marketplace-majority',
  version: '1',
  evidenceTypes: ['billing.invoice_line'],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const revenue = latestMonthRevenue(evidence);
    const marketplace = revenue?.ranked.find(([name]) => /marketplace/i.test(name));
    if (!revenue || !marketplace) return [];
    const [name, amount] = marketplace;
    const share = amount.div(revenue.total);
    if (share.lte('0.5')) return [];
    const terms = findSentence(pages, (sentence) => /(change (its |the )?fees|delist)/i.test(sentence) && /notice/i.test(sentence));
    if (!terms) return [];
    return [
      {
        key: `${revenue.month}:${name}`,
        domain: 'COMMERCIAL',
        title: 'Majority of revenue through one marketplace',
        description: `${name} is ${percent(share)} of ${monthName(revenue.month)} revenue, and the marketplace's seller terms let it change the business unilaterally: “${terms.quote}”`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: 0,
        directionRationale: 'A channel-risk sensitivity in the scenarios (fee or ranking change), not a price term.',
        evidenceIds: revenue.linesOf([name]).slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: terms.page.documentId, pageNumber: terms.page.pageNumber, quote: terms.quote }],
      },
    ];
  },
};

/** Second-month retention by cohort: the cohorts from a point on all keep materially fewer customers than every earlier one. */
export const ECOMMERCE_COHORT_REPEAT_DECLINE: PackRule = {
  id: 'ecommerce-cohort-repeat-decline',
  version: '1',
  evidenceTypes: [COHORT],
  detect: ({ evidence }) => {
    const rows = evidence.filter((row) => row.evidenceType === COHORT);
    const at = (cohort: string, offset: string) => rows.find((row) => row.canonical['first_purchase_month'] === cohort && amountOf(row, 'months_since_first').eq(offset));
    const cohorts = [...new Set(rows.map((row) => row.canonical['first_purchase_month'] ?? ''))]
      .filter((cohort) => /^\d{4}-\d{2}$/.test(cohort))
      .sort()
      .flatMap((cohort) => {
        const first = at(cohort, '0');
        const second = at(cohort, '1');
        const size = first ? amountOf(first, 'active_customers') : new D(0);
        return first && second && size.gt(0) ? [{ cohort, rows: [first, second], kept: amountOf(second, 'active_customers').div(size) }] : [];
      });
    const average = (list: readonly { kept: Decimal }[]) => list.reduce((sum, entry) => sum.plus(entry.kept), new D(0)).div(list.length);
    for (let split = 1; split < cohorts.length; split += 1) {
      const earlier = cohorts.slice(0, split);
      const recent = cohorts.slice(split);
      // A real break: every recent cohort at least three points below every earlier one.
      const floor = D.min(...earlier.map((entry) => entry.kept)).minus('0.03');
      if (!recent.every((entry) => entry.kept.lt(floor))) continue;
      const before = average(earlier);
      const after = average(recent);
      const start = recent[0]?.cohort ?? '';
      return [
        {
          key: start,
          domain: 'COMMERCIAL',
          title: 'Repeat purchase declining in recent cohorts',
          description: `Cohorts from ${monthName(start)} keep ${percent(after)} of customers in their second month, against ${percent(before)} for the ${earlier.length} earlier cohorts (${recent.length} recent cohorts, each at least 3 points below every earlier one).`,
          severity: before.minus(after).gte('0.1') ? 'HIGH' : 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          directionRationale: 'Lifetime value and the growth case should use recent-cohort retention; the reviewer prices the difference.',
          evidenceIds: cohorts.flatMap((entry) => entry.rows).slice(0, MAX_CITED).map((row: PackRuleEvidence) => row.id),
        },
      ];
    }
    return [];
  },
};

/** On a channel, spend rose every month while new customers fell every month, for at least six months. */
export const ECOMMERCE_CHANNEL_CAC_RISING: PackRule = {
  id: 'ecommerce-channel-cac-rising',
  version: '1',
  evidenceTypes: [AD_SPEND],
  detect: ({ evidence }) => {
    const rows = evidence.filter((row) => row.evidenceType === AD_SPEND && /^\d{4}-\d{2}$/.test(row.canonical['month'] ?? ''));
    const channels = [...new Set(rows.map((row) => row.canonical['channel'] ?? ''))].filter(Boolean).sort();
    return channels.flatMap((channel) => {
      const series = rows.filter((row) => row.canonical['channel'] === channel).sort((a, b) => (a.canonical['month'] ?? '').localeCompare(b.canonical['month'] ?? ''));
      if (series.length < 6) return [];
      const rising = series.every((row, index) => index === 0 || (amountOf(row, 'spend').gt(amountOf(series[index - 1] as PackRuleEvidence, 'spend')) && amountOf(row, 'new_customers').lt(amountOf(series[index - 1] as PackRuleEvidence, 'new_customers'))));
      const cac = (row: PackRuleEvidence) => (amountOf(row, 'new_customers').gt(0) ? amountOf(row, 'spend').div(amountOf(row, 'new_customers')) : null);
      const first = series[0] as PackRuleEvidence;
      const last = series.at(-1) as PackRuleEvidence;
      const from = cac(first);
      const to = cac(last);
      if (!rising || !from || !to) return [];
      return [
        {
          key: channel,
          domain: 'COMMERCIAL' as const,
          title: `Acquisition cost rising on ${channel}`,
          description: `On ${channel}, spend rose every month for ${series.length} months while new customers fell every month: acquisition cost (spend ÷ new customers) went from ${from.toFixed(2)} in ${monthName(first.canonical['month'] ?? '')} to ${to.toFixed(2)} in ${monthName(last.canonical['month'] ?? '')} (${percent(to.div(from).minus(1))} higher).`,
          severity: to.div(from).gte('1.5') ? ('HIGH' as const) : ('MEDIUM' as const),
          confidence: 'HIGH' as const,
          direction: -1 as const,
          directionRationale: 'Growth bought on this channel costs more each month; the growth case and price follow, priced by the reviewer.',
          evidenceIds: series.slice(-MAX_CITED).map((row) => row.id),
        },
      ];
    });
  },
};

export const ECOMMERCE_RULES: readonly PackRule[] = [ECOMMERCE_MARKETPLACE_MAJORITY, ECOMMERCE_COHORT_REPEAT_DECLINE, ECOMMERCE_CHANNEL_CAC_RISING];
export const ECOMMERCE_EVIDENCE = { COHORT, AD_SPEND } as const;
