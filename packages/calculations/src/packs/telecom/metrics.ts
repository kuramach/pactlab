import type { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { INVOICE_LINE, monthName } from '../common';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import { agreementRows, AGREEMENT, CAPEX_YEAR, MOVEMENT, movementMonths, REVENUE_MONTH, squeezeYears, streamWindows, TELECOM_SUBSCRIBERS_VERSION, trailingRevenue, trailingSubscribers } from './subscribers';

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal) => value.toFixed(2);
const ratio = (value: Decimal) => value.toFixed(4);

/**
 * The telecom and media pack's figures (T-168): closing subscribers, monthly churn, ARPU and net additions
 * over the trailing twelve months of the subscriber movements export; the largest advertiser's and
 * distributor's share of their stream; the largest agreement in the rights register against trailing
 * revenue; and the latest year's content cost per subscriber and capex intensity. The claims, the rights
 * window against the closing and the trends by year are on the Subscribers tab and in the rules.
 */
export function telecomMetrics(input: PackMetricsInput): PackMetricsReport {
  const trailing = trailingSubscribers(movementMonths(input.evidence));
  const complete = trailing && trailing.missing.length === 0 ? trailing : null;
  const window = complete ? `the twelve months to ${monthName(complete.to)}` : 'twelve complete months';
  const missing = (what: string, needs: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs });
  const movements = missing('subscriber movements export (twelve complete months)', ['TELECOM_SUBSCRIBER_MOVEMENTS']);
  const streams = streamWindows(input.evidence);
  const revenue = trailingRevenue(input.evidence);
  const largest = (stream: string, label: string): PackMetric => {
    const entry = streams.find((candidate) => candidate.stream === stream);
    const top = entry && entry.missing.length === 0 ? entry.counterparties[0] : undefined;
    return {
      key: `largest_${stream}_share`,
      label: top ? `Largest ${label} (${top.counterparty})` : `Largest ${label}`,
      unit: 'RATIO',
      formula: `The largest counterparty’s ${stream} revenue ÷ all ${stream} revenue, trailing twelve months of the statements`,
      sourceCount: top?.rows.length ?? 0,
      ...(top?.share ? { value: ratio(top.share) } : missing('advertising and affiliate revenue by counterparty (twelve complete months)', ['TELECOM_REVENUE_STREAMS'])),
    };
  };
  const agreements = agreementRows(input.evidence);
  const biggest = agreements[0];
  const latestYear = squeezeYears(input.evidence).at(-1);
  const metrics: PackMetric[] = [
    { key: 'subscribers', label: complete ? `Subscribers, ${monthName(complete.to)}` : 'Subscribers', unit: 'COUNT', formula: 'Closing subscribers of the latest month in the movements export', sourceCount: complete?.rows.length ?? 0, ...(complete ? { value: complete.closing.toFixed(0) } : movements) },
    { key: 'monthly_churn', label: 'Monthly churn', unit: 'RATIO', formula: `Disconnects ÷ opening subscribers, ${window}`, sourceCount: complete?.rows.length ?? 0, ...(complete?.churn ? { value: ratio(complete.churn) } : movements) },
    { key: 'arpu', label: 'ARPU (a month)', unit: 'MONEY', formula: `Service revenue ÷ subscriber-months (the average of opening and closing), ${window}`, sourceCount: complete?.rows.length ?? 0, ...(complete?.arpu ? { value: cash(complete.arpu) } : movements) },
    { key: 'net_additions', label: 'Net additions', unit: 'COUNT', formula: `Gross additions − disconnects, ${window}`, sourceCount: complete?.rows.length ?? 0, ...(complete ? { value: complete.adds.minus(complete.disconnects).toFixed(0) } : movements) },
    largest('advertising', 'advertiser'),
    largest('affiliate', 'distributor'),
    {
      key: 'largest_agreement_share',
      label: biggest ? `Largest agreement (${biggest.agreementId})` : 'Largest agreement',
      unit: 'RATIO',
      formula: 'The register’s largest annual value ÷ trailing twelve months of billed, advertising and affiliate revenue',
      sourceCount: biggest ? 1 : 0,
      ...(biggest && revenue?.total.gt(0) ? { value: ratio(biggest.annualValue.div(revenue.total)) } : missing('rights and carriage register and the billing export', ['TELECOM_AGREEMENTS', 'BILLING_INVOICE_LINE'])),
    },
    {
      key: 'content_per_subscriber',
      label: latestYear ? `Content cost per subscriber a month, ${latestYear.year}` : 'Content cost per subscriber a month',
      unit: 'MONEY',
      formula: 'The P&L’s content and programming lines ÷ the year’s subscriber-months, latest year in both',
      sourceCount: latestYear ? latestYear.contentIds.length + latestYear.subscriberIds.length : 0,
      ...(latestYear?.contentPerSubscriber ? { value: cash(latestYear.contentPerSubscriber) } : missing('P&L by year and the subscriber movements export for the same years', ['FINANCIAL_PNL', 'TELECOM_SUBSCRIBER_MOVEMENTS'])),
    },
    {
      key: 'capex_intensity',
      label: latestYear ? `Capex intensity, ${latestYear.year}` : 'Capex intensity',
      unit: 'RATIO',
      formula: 'Capital expenditure ÷ the P&L’s revenue, latest year in both',
      sourceCount: latestYear?.capexIds.length ?? 0,
      ...(latestYear?.capexIntensity ? { value: ratio(latestYear.capexIntensity) } : missing('capital expenditure by year and the P&L for the same years', ['TELECOM_CAPEX', 'FINANCIAL_PNL'])),
    },
  ];
  return { calculator: 'telecom-subscribers', version: TELECOM_SUBSCRIBERS_VERSION, currency: input.currency, metrics };
}

export const TELECOM_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'telecom-subscribers',
  version: TELECOM_SUBSCRIBERS_VERSION,
  evidenceTypes: [MOVEMENT, REVENUE_MONTH, AGREEMENT, CAPEX_YEAR, INVOICE_LINE, PNL_LINE],
  compute: telecomMetrics,
};
