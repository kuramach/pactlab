import type { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { packHistory, withHistory, type PackHistorySpec } from '../history';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import { HEALTHCARE_HISTORY } from './rules';
import { monthName } from '../common';
import {
  CLINICIAN_MONTH,
  clinicianMonths,
  clinicianShares,
  CREDENTIAL,
  credentialRows,
  credentialStatuses,
  classGroupShare,
  GOVERNMENT_CLASSES,
  HEALTHCARE_COLLECTIONS_VERSION,
  healthcareAnalysisDate,
  PAYER_CONTRACT,
  payerContracts,
  payerContractStatuses,
  REMITTANCE,
  remittanceMonths,
  trailingCollections,
} from './practice';

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal) => value.toFixed(2);
const ratio = (value: Decimal) => value.toFixed(4);
const count = (value: number) => String(value);

/**
 * The healthcare pack's figures (T-160): collections, charges, the gross collection rate, the denial
 * rate and days in AR over the trailing twelve months from the remittance export; the commercial and
 * government shares of collections; the largest clinician's share from the collections export; and the
 * credentialing and payer contract registers at the analysis date. The verification documents can move
 * a credential's date; that is read on the Practice tab and by the rules.
 */
export function healthcareMetrics(input: PackMetricsInput, historySpec: PackHistorySpec = HEALTHCARE_HISTORY): PackMetricsReport {
  const rows = remittanceMonths(input.evidence);
  const window = trailingCollections(rows);
  const trailing = window && window.missing.length === 0 ? window : null;
  const asOf = healthcareAnalysisDate(rows);
  const clinicians = clinicianShares(clinicianMonths(input.evidence));
  const top = clinicians && clinicians.missing.length === 0 ? (clinicians.clinicians[0] ?? null) : null;
  const credentials = credentialStatuses(credentialRows(input.evidence), [], asOf, clinicianMonths(input.evidence));
  const contracts = payerContracts(input.evidence);
  const contractStatuses = payerContractStatuses(rows, contracts, asOf);
  const span = trailing ? `the twelve months to ${monthName(trailing.to)}` : 'twelve complete months';
  const missing = (what: string, needs: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs });
  const needRemittances = missing('remittance export (twelve complete months)', ['HEALTHCARE_REMITTANCES']);
  const size = trailing?.rows.length ?? 0;
  const commercial = trailing ? classGroupShare(trailing, ['commercial']) : null;
  const government = trailing ? classGroupShare(trailing, GOVERNMENT_CLASSES) : null;
  const metrics: PackMetric[] = [
    { key: 'collected', label: 'Collected, trailing', unit: 'MONEY', formula: `Σ cash collected in ${span}, every payer`, sourceCount: size, ...(trailing ? { value: cash(trailing.collected) } : needRemittances) },
    { key: 'billed', label: 'Charges billed, trailing', unit: 'MONEY', formula: `Σ gross charges in ${span}`, sourceCount: size, ...(trailing ? { value: cash(trailing.billed) } : needRemittances) },
    { key: 'collection_rate', label: 'Gross collection rate', unit: 'RATIO', formula: 'Trailing collected ÷ trailing charges billed', sourceCount: size, ...(trailing?.collectionRate ? { value: ratio(trailing.collectionRate) } : needRemittances) },
    { key: 'denial_rate', label: 'Denial rate, trailing', unit: 'RATIO', formula: 'Denied ÷ adjudicated claims, trailing twelve months', sourceCount: size, ...(trailing?.denialRate ? { value: ratio(trailing.denialRate) } : needRemittances) },
    {
      key: 'days_in_ar',
      label: 'Days in accounts receivable',
      unit: 'COUNT',
      formula: 'Receivables at the latest month end ÷ (trailing charges billed ÷ 365)',
      sourceCount: size,
      ...(trailing?.daysInAr ? { value: trailing.daysInAr.toFixed(1) } : missing('remittance export with receivables at month end', ['HEALTHCARE_REMITTANCES'])),
    },
    { key: 'commercial_share', label: 'Commercial share of collections', unit: 'RATIO', formula: 'Commercial payers’ collections ÷ all collections, trailing', sourceCount: size, ...(commercial ? { value: ratio(commercial) } : needRemittances) },
    { key: 'government_share', label: 'Government share of collections', unit: 'RATIO', formula: 'Medicare, Medicaid and other government collections ÷ all collections, trailing', sourceCount: size, ...(government ? { value: ratio(government) } : needRemittances) },
    {
      key: 'top_clinician_share',
      label: 'Largest clinician’s share of collections',
      unit: 'RATIO',
      formula: 'The largest single clinician’s collections ÷ all collections in the collections export, trailing twelve months (pseudonymous; a retention risk, never a ranking)',
      sourceCount: top?.rows.length ?? 0,
      ...(top?.share ? { value: ratio(top.share) } : missing('collections by clinician (twelve complete months)', ['HEALTHCARE_CLINICIAN_COLLECTIONS'])),
    },
    {
      key: 'credentials_expired',
      label: 'Credentials expired at the analysis date',
      unit: 'COUNT',
      formula: 'Register rows expired, suspended or revoked, or past their expiry at the end of the latest remittance month (verification documents can move a date on the Practice tab)',
      sourceCount: credentials.length,
      ...(credentials.length ? { value: count(credentials.filter((status) => status.state === 'EXPIRED').length) } : missing('credentialing register', ['HEALTHCARE_CREDENTIALS'])),
    },
    {
      key: 'contracts_expiring',
      label: 'Payer contracts ending within a year',
      unit: 'COUNT',
      formula: 'Payers remitting in the trailing twelve months whose contract ends within 365 days of the analysis date without automatic renewal, or has ended',
      sourceCount: contracts.length,
      ...(contracts.length && contractStatuses.length ? { value: count(contractStatuses.filter((status) => status.state === 'EXPIRING' || status.state === 'EXPIRED').length) } : missing('payer contract register and the remittance export', ['HEALTHCARE_PAYER_CONTRACTS', 'HEALTHCARE_REMITTANCES'])),
    },
  ];
  // Five years (T-184b): the P&L, visits, the commercial share and the denial rate by year; the two rates carry a History strip.
  const history = packHistory(historySpec, input.evidence, input);
  const strips = new Set(['commercial_share', 'denial_rate']);
  return {
    calculator: 'healthcare-collections',
    version: HEALTHCARE_COLLECTIONS_VERSION,
    currency: input.currency,
    metrics: metrics.map((metric) => (strips.has(metric.key) ? withHistory(metric, history, metric.key) : metric)),
    history: history.table,
  };
}

export const HEALTHCARE_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'healthcare-collections',
  version: HEALTHCARE_COLLECTIONS_VERSION,
  evidenceTypes: [REMITTANCE, CLINICIAN_MONTH, CREDENTIAL, PAYER_CONTRACT, PNL_LINE],
  compute: healthcareMetrics,
};
