import type { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { CLINICIAN_MONTH, CREDENTIAL, PAYER_CONTRACT, REMITTANCE } from '../healthcare/practice';
import { healthcareMetrics } from '../healthcare/metrics';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import { CLINICS_HISTORY } from './rules';
import { CLINICS_PRACTICE_VERSION, REFERRAL_MONTH, referralMonths, referralWindow, SERVICE_LINE_MONTH, serviceLineMonths, serviceLineWindow } from './practice';

type Decimal = InstanceType<typeof D>;
const ratio = (value: Decimal) => value.toFixed(4);

/**
 * The small clinics pack's figures (T-161): the healthcare collections figures as they are (T-160 —
 * collections, denials, days in AR, payer mix, the largest clinician, credentials and payer contracts),
 * then the clinic's own: the largest service line's share of collections and the highest margin after
 * direct costs, from the service-line export, and the largest referral source's share of visits. The
 * selling owner and the lease are read from documents, so they are on the Clinic tab and in the rules.
 */
export function clinicsMetrics(input: PackMetricsInput): PackMetricsReport {
  const lines = serviceLineWindow(serviceLineMonths(input.evidence));
  const complete = lines && lines.missing.length === 0 ? lines : null;
  const best = complete?.lines.find((line) => line.margin !== null) ?? null;
  const largest = complete ? [...complete.lines].sort((a, b) => b.collected.comparedTo(a.collected))[0] ?? null : null;
  const referrals = referralWindow(referralMonths(input.evidence));
  const top = referrals && referrals.missing.length === 0 ? (referrals.sources[0] ?? null) : null;
  const missing = (what: string, needs: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs });
  const clinic: PackMetric[] = [
    {
      key: 'largest_service_line_share',
      label: largest ? `Largest service line’s share of collections (${largest.serviceLine})` : 'Largest service line’s share of collections',
      unit: 'RATIO',
      formula: 'The largest service line’s collections ÷ all collections in the service-line export, trailing twelve months',
      sourceCount: largest?.rows.length ?? 0,
      ...(largest?.share ? { value: ratio(largest.share) } : missing('service lines by provider (twelve complete months)', ['CLINICS_SERVICE_LINES'])),
    },
    {
      key: 'best_service_line_margin',
      label: best ? `Highest service-line margin (${best.serviceLine})` : 'Highest service-line margin',
      unit: 'RATIO',
      formula: '(Collected − direct cost) ÷ collected for the line with the highest margin, trailing twelve months',
      sourceCount: best?.rows.length ?? 0,
      ...(best?.margin ? { value: ratio(best.margin) } : missing('service lines by provider with direct costs (twelve complete months)', ['CLINICS_SERVICE_LINES'])),
    },
    {
      key: 'top_referral_share',
      label: top ? `Largest referral source’s share of visits (${top.source})` : 'Largest referral source’s share of visits',
      unit: 'RATIO',
      formula: 'Visits from the largest referral source ÷ all visits in the referral export, trailing twelve months',
      sourceCount: top?.rows.length ?? 0,
      ...(top?.share ? { value: ratio(top.share) } : missing('visits by referral source (twelve complete months)', ['CLINICS_REFERRALS'])),
    },
  ];
  const healthcare = healthcareMetrics(input, CLINICS_HISTORY);
  return { calculator: 'clinics-practice', version: CLINICS_PRACTICE_VERSION, currency: input.currency, metrics: [...healthcare.metrics, ...clinic], ...(healthcare.history ? { history: healthcare.history } : {}) };
}

export const CLINICS_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'clinics-practice',
  version: CLINICS_PRACTICE_VERSION,
  evidenceTypes: [REMITTANCE, CLINICIAN_MONTH, CREDENTIAL, PAYER_CONTRACT, SERVICE_LINE_MONTH, REFERRAL_MONTH, PNL_LINE],
  compute: clinicsMetrics,
};
