import { D } from '../../metrics/decimal';
import { amountOf, documentClauseRule, grouped, latestMonthRevenue, percent } from '../common';
import { findSentence, MAX_CITED, type PackRule, type PackRuleEvidence } from '../rule-types';

/**
 * Commercial property pack rules (T-066, spec §19). Tenants are businesses;
 * the rent roll is lease data, never people data.
 */
const LEASE = 'cre.lease';
const CAM = 'cre.cam_category';
type Decimal = InstanceType<typeof D>;

const DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const dayNumber = (date: string) => {
  const match = DATE.exec(date);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000 : null;
};
/** The last day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const bareName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim();
const leases = (evidence: readonly PackRuleEvidence[]) => evidence.filter((row) => row.evidenceType === LEASE && dayNumber(row.canonical['lease_end'] ?? '') !== null);
const rentOf = (row: PackRuleEvidence) => amountOf(row, 'monthly_base_rent');
const largestLease = (rows: readonly PackRuleEvidence[]) => [...rows].sort((a, b) => rentOf(b).comparedTo(rentOf(a)) || (a.canonical['suite'] ?? '').localeCompare(b.canonical['suite'] ?? ''))[0];

/**
 * The anchor tenant carries a large share of base rent and its lease ends
 * within two years of the latest billed month; the lease abstract that names
 * the tenant confirms the term. Reports the rent-weighted average lease term.
 */
export const CRE_ANCHOR_ROLLOVER: PackRule = {
  id: 'cre-anchor-rollover',
  version: '1',
  evidenceTypes: [LEASE, 'billing.invoice_line'],
  readsDocuments: true,
  detect: ({ evidence, pages }) => {
    const rows = leases(evidence);
    const revenue = latestMonthRevenue(evidence);
    const anchor = largestLease(rows);
    if (!revenue || !anchor) return [];
    const asOf = monthEnd(revenue.month);
    const today = dayNumber(asOf) ?? 0;
    const total = rows.reduce((sum, row) => sum.plus(rentOf(row)), new D(0));
    if (!total.gt(0)) return [];
    const share = rentOf(anchor).div(total);
    const remaining = (row: PackRuleEvidence) => D.max(0, new D((dayNumber(row.canonical['lease_end'] ?? '') ?? today) - today).div('365.25'));
    const walt = rows.reduce((sum, row) => sum.plus(rentOf(row).times(remaining(row))), new D(0)).div(total);
    if (share.lt('0.3') || remaining(anchor).gt(2)) return [];
    const tenant = anchor.canonical['tenant'] ?? '';
    const named = new Set(pages.filter((page) => page.text.includes(bareName(tenant))).map((page) => page.documentId));
    const term = findSentence(
      pages.filter((page) => named.has(page.documentId)),
      (sentence) => /\b(term|lease) (ends|expires)\b/i.test(sentence),
    );
    if (!term) return [];
    return [
      {
        key: `${anchor.canonical['suite']}:${anchor.canonical['lease_end']}`,
        domain: 'PROPERTY',
        title: 'Anchor tenant concentration and near-term expiry',
        description: `${tenant} is ${percent(share)} of base rent and its lease ends ${anchor.canonical['lease_end']} (${remaining(anchor).toFixed(1)} years after ${asOf}). Weighted average lease term is ${walt.toFixed(1)} years. The lease abstract: “${term.quote}”`,
        severity: 'HIGH',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'Rollover risk on the largest lease: the rollover schedule and cap rate follow; the reviewer prices it or makes renewal a condition.',
        evidenceIds: rows.slice(0, MAX_CITED).map((row) => row.id),
        quotes: [{ documentId: term.page.documentId, pageNumber: term.page.pageNumber, quote: term.quote }],
      },
    ];
  },
};

export const CRE_ENVIRONMENTAL_CONDITION = documentClauseRule({
  id: 'cre-environmental-condition',
  title: 'Recognized environmental condition',
  domain: 'PROPERTY',
  severity: 'HIGH',
  direction: -1,
  directionRationale: 'Remediation cost is unknown until the Phase II; an escrow or indemnity the reviewer prices.',
  sentences: [(sentence) => /recogni[sz]ed environmental condition/i.test(sentence), (sentence) => /phase ii/i.test(sentence)],
  description: ([condition, next]) => `The Phase I environmental site assessment identifies a recognized environmental condition: “${condition}” “${next}”`,
});

/** CAM categories that recover less from tenants than they cost, in the latest reconciliation year. */
export const CRE_CAM_UNDER_RECOVERY: PackRule = {
  id: 'cre-cam-under-recovery',
  version: '1',
  evidenceTypes: [CAM],
  detect: ({ evidence }) => {
    const rows = evidence.filter((row) => row.evidenceType === CAM && /^\d{4}$/.test(row.canonical['year'] ?? ''));
    const year = rows.map((row) => row.canonical['year'] ?? '').sort().at(-1);
    const inYear = rows.filter((row) => row.canonical['year'] === year);
    const short = inYear.filter((row) => amountOf(row, 'recoveries').lt(amountOf(row, 'expenses')));
    const expenses = inYear.reduce((sum, row) => sum.plus(amountOf(row, 'expenses')), new D(0));
    const gap = short.reduce((sum: Decimal, row) => sum.plus(amountOf(row, 'expenses').minus(amountOf(row, 'recoveries'))), new D(0));
    if (!year || short.length === 0 || !expenses.gt(0) || gap.div(expenses).lt('0.02')) return [];
    return [
      {
        key: year,
        domain: 'PROPERTY',
        title: 'CAM recoveries below expenses',
        description: `In ${year}, ${short.map((row) => `${row.canonical['category']} (${grouped(amountOf(row, 'expenses'))} spent, ${grouped(amountOf(row, 'recoveries'))} recovered)`).join(' and ')} recovered less than they cost: ${grouped(gap)} a year in the deal's currency, ${percent(gap.div(expenses))} of CAM expenses, comes out of NOI.`,
        severity: gap.div(expenses).gte('0.1') ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        direction: -1,
        directionRationale: 'NOI should carry the unrecovered CAM; at the cap rate that is a price adjustment the reviewer sets.',
        evidenceIds: short.map((row) => row.id),
      },
    ];
  },
};

/**
 * The largest lease pays the deepest discount to market rent on the roll.
 * Upside the buyer confirms on renewal — never a reason to pay more.
 */
export const CRE_BELOW_MARKET_ANCHOR: PackRule = {
  id: 'cre-below-market-anchor',
  version: '1',
  evidenceTypes: [LEASE],
  detect: ({ evidence }) => {
    const rows = leases(evidence).filter((row) => amountOf(row, 'monthly_market_rent').gt(0));
    const anchor = largestLease(rows);
    if (!anchor) return [];
    const discount = (row: PackRuleEvidence) => new D(1).minus(rentOf(row).div(amountOf(row, 'monthly_market_rent')));
    const deepest = D.max(...rows.map(discount));
    if (discount(anchor).lt('0.03') || discount(anchor).lt(deepest)) return [];
    const yearly = amountOf(anchor, 'monthly_market_rent').minus(rentOf(anchor)).times(12);
    const tenant = anchor.canonical['tenant'] ?? '';
    return [
      {
        key: `${anchor.canonical['suite']}`,
        domain: 'PROPERTY',
        title: 'Below-market anchor rent (upside, not price)',
        description: `${tenant} pays ${percent(discount(anchor))} below market rent — the deepest discount on the rent roll, on the largest lease: ${grouped(yearly)} a year in the deal's currency if it resets to market. Confirmed value — never a reason to pay more.`,
        severity: 'LOW',
        confidence: 'MEDIUM',
        direction: 1,
        valueConfirmation: {
          valueDriver: 'Below-market anchor rent',
          impliedValue: null,
          basis: `Rent roll: ${tenant} base rent ${grouped(rentOf(anchor))} a month against market ${grouped(amountOf(anchor, 'monthly_market_rent'))}.`,
        },
        evidenceIds: [anchor.id],
      },
    ];
  },
};

export const COMMERCIAL_PROPERTY_RULES: readonly PackRule[] = [CRE_ANCHOR_ROLLOVER, CRE_ENVIRONMENTAL_CONDITION, CRE_CAM_UNDER_RECOVERY, CRE_BELOW_MARKET_ANCHOR];
export const COMMERCIAL_PROPERTY_EVIDENCE = { LEASE, CAM } as const;
