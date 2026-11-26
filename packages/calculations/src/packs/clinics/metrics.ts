import { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { amountOf } from '../common';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE, pnlYears } from '../pnl-trend';
import type { PackRuleEvidence } from '../rule-types';
import { CLINICS_EVIDENCE, CLINICS_PNL_EXPENSES, ownerDependence, serviceLineMargins, trailingVisits } from './rules';

export const CLINICS_METRICS_VERSION = 'clinics-metrics-1';

type Decimal = InstanceType<typeof D>;
const CLAIMS = 'healthcare.claims_month';
const ROSTER = 'healthcare.provider';
const ratio = (value: Decimal) => value.toFixed(4);
const cash = (value: Decimal) => value.toFixed(2);
const total = (rows: readonly PackRuleEvidence[], field: string) => rows.reduce((sum, row) => sum.plus(amountOf(row, field)), new D(0));

/**
 * The small-clinic figures (T-161), each with its formula and the rows behind it: the selling owner's
 * share, the largest referral source, payer mix, denials and collections from the claims summary,
 * the credentialing register, service-line margins, and the P&L by fiscal year — every imported
 * year, so one year reports its own figures and several show the trend. A figure whose import is
 * missing says which import it needs (never filled in).
 */
export function clinicsMetrics(input: PackMetricsInput): PackMetricsReport {
  const missing = (what: string, needs: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs });
  const visits = trailingVisits(input.evidence);
  const owner = ownerDependence(input.evidence);
  const bySource = new Map<string, Decimal>();
  for (const row of visits.rows) bySource.set(row.canonical['referral_source'] ?? '', (bySource.get(row.canonical['referral_source'] ?? '') ?? new D(0)).plus(amountOf(row, 'visits')));
  const visitTotal = total(visits.rows, 'visits');
  const topSource = [...bySource.values()].sort((a, b) => b.comparedTo(a))[0];

  const claims = input.evidence.filter((row) => row.evidenceType === CLAIMS && /^\d{4}-\d{2}$/.test(row.canonical['month'] ?? ''));
  const claimMonths = [...new Set(claims.map((row) => row.canonical['month'] ?? ''))].sort().slice(-12);
  const trailingClaims = claims.filter((row) => claimMonths.includes(row.canonical['month'] ?? ''));
  const claimCount = total(trailingClaims, 'claims');
  const denied = trailingClaims.reduce((sum, row) => sum.plus(amountOf(row, 'claims').times(amountOf(row, 'denial_rate_pct'))), new D(0));
  const billed = total(trailingClaims, 'billed');
  const paid = total(trailingClaims, 'paid');
  const byPayer = new Map<string, Decimal>();
  for (const row of trailingClaims) byPayer.set(row.canonical['payer'] ?? '', (byPayer.get(row.canonical['payer'] ?? '') ?? new D(0)).plus(amountOf(row, 'paid')));
  const topPayer = [...byPayer.values()].sort((a, b) => b.comparedTo(a))[0];

  const roster = input.evidence.filter((row) => row.evidenceType === ROSTER);
  const latestMonth = [...claimMonths, ...visits.window].sort().at(-1);
  const horizon = latestMonth ? new Date(Date.UTC(Number(latestMonth.slice(0, 4)) + 1, Number(latestMonth.slice(5, 7)), 0)).toISOString().slice(0, 10) : null;
  const lapsing = horizon ? roster.filter((row) => (row.canonical['credential_expiry'] ?? '9999') <= horizon) : [];

  const margins = serviceLineMargins(input.evidence);
  const best = margins ? [...margins.margins.entries()].sort((a, b) => b[1].comparedTo(a[1]))[0] : undefined;
  const years = pnlYears(input.evidence, CLINICS_PNL_EXPENSES);
  const pnlRows = input.evidence.filter((row) => row.evidenceType === PNL_LINE).length;

  const metrics: PackMetric[] = [
    {
      key: 'owner_collection_share',
      label: 'Selling owner’s share of collections',
      unit: 'RATIO',
      formula: `Collections delivered by providers in the owner role ÷ all collections, ${visits.window.length} months to ${visits.window.at(-1) ?? 'the latest month'}`,
      sourceCount: visits.rows.length,
      ...(owner.collectionShare ? { value: ratio(owner.collectionShare) } : missing('visit summary', ['CLINICS_VISITS'])),
    },
    {
      key: 'owner_visit_share',
      label: 'Selling owner’s share of visits',
      unit: 'RATIO',
      formula: 'Visits delivered by providers in the owner role ÷ all visits, same twelve months',
      sourceCount: visits.rows.length,
      ...(owner.visitShare ? { value: ratio(owner.visitShare) } : missing('visit summary', ['CLINICS_VISITS'])),
    },
    {
      key: 'owner_only_service_lines',
      label: 'Service lines only the owner delivers',
      unit: 'COUNT',
      formula: 'Service lines with visits in the twelve months, every one of them delivered by the owner',
      sourceCount: visits.rows.length,
      ...(visits.rows.length ? { value: String(owner.ownerOnly.length) } : missing('visit summary', ['CLINICS_VISITS'])),
    },
    {
      key: 'top_referral_share',
      label: 'Largest referral source’s share of visits',
      unit: 'RATIO',
      formula: 'Visits from the largest referral source ÷ all visits, same twelve months (self-referral included)',
      sourceCount: visits.rows.length,
      ...(topSource && visitTotal.gt(0) ? { value: ratio(topSource.div(visitTotal)) } : missing('visit summary', ['CLINICS_VISITS'])),
    },
    {
      key: 'denial_rate',
      label: 'Denial rate (claims-weighted)',
      unit: 'RATIO',
      formula: `Σ claims × denial rate ÷ Σ claims, ${claimMonths.length} months to ${claimMonths.at(-1) ?? 'the latest month'}`,
      sourceCount: trailingClaims.length,
      ...(claimCount.gt(0) ? { value: ratio(denied.div(claimCount).div(100)) } : missing('claims summary', ['HEALTHCARE_CLAIMS_SUMMARY'])),
    },
    {
      key: 'collection_rate',
      label: 'Paid ÷ billed',
      unit: 'RATIO',
      formula: 'Σ paid ÷ Σ billed over the claims summary, same months',
      sourceCount: trailingClaims.length,
      ...(billed.gt(0) ? { value: ratio(paid.div(billed)) } : missing('claims summary', ['HEALTHCARE_CLAIMS_SUMMARY'])),
    },
    {
      key: 'top_payer_share',
      label: 'Largest payer’s share of payments',
      unit: 'RATIO',
      formula: 'Paid by the largest payer ÷ all paid, same months',
      sourceCount: trailingClaims.length,
      ...(topPayer && paid.gt(0) ? { value: ratio(topPayer.div(paid)) } : missing('claims summary', ['HEALTHCARE_CLAIMS_SUMMARY'])),
    },
    {
      key: 'roster_providers',
      label: 'Providers on the roster',
      unit: 'COUNT',
      formula: 'Pseudonymous providers in the provider roster',
      sourceCount: roster.length,
      ...(roster.length ? { value: String(roster.length) } : missing('provider roster', ['HEALTHCARE_PROVIDER_ROSTER'])),
    },
    {
      key: 'credentials_lapsing',
      label: 'Credentials lapsed or lapsing within a year',
      unit: 'COUNT',
      formula: `Roster providers whose credential expiry is on or before ${horizon ?? 'a year after the latest month'}`,
      sourceCount: roster.length,
      ...(roster.length && horizon ? { value: String(lapsing.length) } : missing('provider roster and the claims or visit summary', ['HEALTHCARE_PROVIDER_ROSTER', 'CLINICS_VISITS'])),
    },
    {
      key: 'best_service_line_margin',
      label: best ? `Highest service-line margin (${best[0]}, ${margins?.year})` : 'Highest service-line margin',
      unit: 'RATIO',
      formula: '(Revenue − direct costs) ÷ revenue, per service line, latest fiscal year',
      sourceCount: margins?.rows.length ?? 0,
      ...(best ? { value: ratio(best[1]) } : missing('service-line margins', ['CLINICS_SERVICE_LINES'])),
    },
    {
      key: 'pnl_years',
      label: 'P&L fiscal years imported',
      unit: 'COUNT',
      formula: 'Complete fiscal years in the imported P&L (a year as stated, or twelve months rolled up)',
      sourceCount: pnlRows,
      ...(years.length ? { value: String(years.length) } : missing('P&L, by year', ['FINANCIAL_PNL'])),
    },
  ];
  years.forEach((year, index) => {
    const rows = year.period.sources.length;
    const previous = years[index - 1];
    metrics.push({ key: `revenue_${year.year}`, label: `Revenue ${year.year}`, unit: 'MONEY', formula: 'Σ revenue lines of the imported P&L for the year', sourceCount: rows, value: cash(year.revenue) });
    if (previous && previous.revenue.gt(0)) {
      metrics.push({ key: `revenue_growth_${year.year}`, label: `Revenue growth ${year.year}`, unit: 'RATIO', formula: `Revenue ${year.year} ÷ revenue ${previous.year} − 1`, sourceCount: rows + previous.period.sources.length, value: ratio(year.revenue.div(previous.revenue).minus(1)) });
    }
    if (year.grossMargin) metrics.push({ key: `gross_margin_${year.year}`, label: `Gross margin ${year.year}`, unit: 'RATIO', formula: '(Revenue − cost of revenue) ÷ revenue', sourceCount: rows, value: ratio(year.grossMargin) });
    if (year.operatingMargin) metrics.push({ key: `operating_margin_${year.year}`, label: `Operating margin ${year.year}`, unit: 'RATIO', formula: '(Revenue − cost of revenue − operating expenses) ÷ revenue', sourceCount: rows, value: ratio(year.operatingMargin) });
    for (const expense of CLINICS_PNL_EXPENSES) {
      const line = year.expenses[expense.key];
      if (line?.ratio) metrics.push({ key: `${expense.key}_ratio_${year.year}`, label: `${expense.label} ÷ revenue ${year.year}`, unit: 'RATIO', formula: `Σ P&L lines named like ${expense.label.toLowerCase()} ÷ revenue`, sourceCount: line.evidenceIds.length, value: ratio(line.ratio) });
    }
  });
  return { calculator: 'clinics-metrics', version: CLINICS_METRICS_VERSION, currency: input.currency, metrics };
}

export const CLINICS_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'clinics-metrics',
  version: CLINICS_METRICS_VERSION,
  evidenceTypes: [CLINICS_EVIDENCE.VISITS, CLINICS_EVIDENCE.SERVICE_LINES, CLAIMS, ROSTER, PNL_LINE],
  compute: clinicsMetrics,
};
