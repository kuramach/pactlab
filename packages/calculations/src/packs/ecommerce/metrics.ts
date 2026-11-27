import type { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { monthName } from '../common';
import { packHistory, withHistory } from '../history';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import { ECOMMERCE_HISTORY } from './rules';
import { AD_SPEND_MONTH, AGED_STOCK_DAYS, CHANNEL_MONTH, channelModel, channelMonths, COHORT_MONTH, cohortValue, ECOMMERCE_CHANNELS_VERSION, inventoryAgeing, paidAcquisition, STOCK_LOT, stockLots } from './channels';

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal) => value.toFixed(2);
const ratio = (value: Decimal) => value.toFixed(4);

/**
 * The e-commerce and DTC pack's figures (T-164): net sales and the largest platform account's share
 * recomputed from the orders export; consumer order value and contribution margin; orders per customer
 * from the cohorts and the lifetime value on a contribution basis; paid acquisition cost from the
 * ad-spend export; the return rate; and the stock report's value and aged share. The claims, the
 * account ownership the documents state and the trends by year are on the Channels tab and in the rules.
 */
export function ecommerceMetrics(input: PackMetricsInput): PackMetricsReport {
  const model = channelModel(channelMonths(input.evidence));
  const trailing = model.trailing && model.trailing.missing.length === 0 ? model.trailing : null;
  const consumer = model.consumer && model.consumer.missing.length === 0 ? model.consumer : null;
  const value = cohortValue(input.evidence);
  const paid = paidAcquisition(input.evidence);
  const ageing = inventoryAgeing(stockLots(input.evidence));
  const largest = model.accounts[0] ?? null;
  const window = trailing ? `the twelve months to ${monthName(trailing.to)}` : 'twelve complete months';
  const missing = (what: string, needs: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs });
  const orders = missing('orders by channel (twelve complete months)', ['ECOMMERCE_CHANNEL_ORDERS']);
  const metrics: PackMetric[] = [
    { key: 'net_sales', label: 'Net sales, trailing', unit: 'MONEY', formula: `Σ gross sales − discounts − returns in ${window}, every channel`, sourceCount: trailing?.rows.length ?? 0, ...(trailing ? { value: cash(trailing.net) } : orders) },
    {
      key: 'largest_account_share',
      label: largest ? `Largest platform account (${largest.channel}, ${largest.account})` : 'Largest platform account',
      unit: 'RATIO',
      formula: 'The account’s net sales ÷ all net sales, trailing twelve months',
      sourceCount: largest?.rows.length ?? 0,
      ...(trailing && largest?.share ? { value: ratio(largest.share) } : orders),
    },
    { key: 'net_order_value', label: 'Net order value, consumer channels', unit: 'MONEY', formula: 'Consumer net sales ÷ consumer orders, trailing twelve months', sourceCount: consumer?.rows.length ?? 0, ...(consumer?.orders.gt(0) ? { value: cash(consumer.net.div(consumer.orders)) } : orders) },
    {
      key: 'contribution_margin',
      label: 'Contribution margin, consumer channels',
      unit: 'RATIO',
      formula: '(Net sales − cost of goods − fulfilment − marketplace and payment fees) ÷ net sales, trailing twelve months',
      sourceCount: consumer?.rows.length ?? 0,
      ...(consumer?.contributionMargin ? { value: ratio(consumer.contributionMargin) } : orders),
    },
    {
      key: 'orders_per_customer',
      label: 'Orders per customer, first 12 months',
      unit: 'RATIO',
      formula: 'Σ active customer-months over the first 12 months ÷ first-month customers, every cohort observed for all 12',
      sourceCount: value?.repeat.rows.length ?? 0,
      ...(value ? { value: value.repeat.ordersPerCustomer.toFixed(4) } : missing('orders by cohort (12 months of history) and orders by channel', ['ECOMMERCE_COHORTS', 'ECOMMERCE_CHANNEL_ORDERS'])),
    },
    {
      key: 'ltv_contribution',
      label: 'Lifetime value, 12 months, contribution basis',
      unit: 'MONEY',
      formula: 'Orders per customer × consumer contribution per order',
      sourceCount: (value?.repeat.rows.length ?? 0) + (value?.window.rows.length ?? 0),
      ...(value ? { value: cash(value.ltvContribution) } : missing('orders by cohort and orders by channel', ['ECOMMERCE_COHORTS', 'ECOMMERCE_CHANNEL_ORDERS'])),
    },
    { key: 'paid_cac', label: 'Paid acquisition cost', unit: 'MONEY', formula: 'Ad spend ÷ attributed new customers, the ad-spend export’s trailing twelve months', sourceCount: paid?.rows.length ?? 0, ...(paid?.cac && paid.missing.length === 0 ? { value: cash(paid.cac) } : missing('ad spend (twelve complete months)', ['ECOMMERCE_AD_SPEND'])) },
    {
      key: 'ltv_to_cac',
      label: 'Lifetime value ÷ paid acquisition cost',
      unit: 'RATIO',
      formula: 'Contribution-basis lifetime value ÷ paid acquisition cost',
      sourceCount: (value?.repeat.rows.length ?? 0) + (paid?.rows.length ?? 0),
      ...(value && paid?.cac && paid.missing.length === 0 ? { value: value.ltvContribution.div(paid.cac).toFixed(2) } : missing('orders by cohort, orders by channel and ad spend', ['ECOMMERCE_COHORTS', 'ECOMMERCE_CHANNEL_ORDERS', 'ECOMMERCE_AD_SPEND'])),
    },
    { key: 'return_rate', label: 'Return rate, trailing', unit: 'RATIO', formula: `Returns refunded ÷ gross sales in ${window}`, sourceCount: trailing?.rows.length ?? 0, ...(trailing?.returnRate ? { value: ratio(trailing.returnRate) } : orders) },
    { key: 'stock_value', label: ageing ? `Stock at cost, ${ageing.asOf}` : 'Stock at cost', unit: 'MONEY', formula: 'Σ units × unit cost in the latest stock report', sourceCount: ageing?.lots.length ?? 0, ...(ageing ? { value: cash(ageing.value) } : missing('stock report', ['ECOMMERCE_INVENTORY'])) },
    {
      key: 'stock_aged_share',
      label: `Stock older than ${AGED_STOCK_DAYS} days`,
      unit: 'RATIO',
      formula: `Value of lots received more than ${AGED_STOCK_DAYS} days before the report date ÷ all stock value`,
      sourceCount: ageing?.lots.length ?? 0,
      ...(ageing?.agedShare ? { value: ratio(ageing.agedShare) } : missing('stock report', ['ECOMMERCE_INVENTORY'])),
    },
  ];
  // Five years (T-184b): the P&L, orders, order value, repeat orders and the discount rate by year; order value carries a History strip.
  const history = packHistory(ECOMMERCE_HISTORY, input.evidence);
  return {
    calculator: 'ecommerce-channels',
    version: ECOMMERCE_CHANNELS_VERSION,
    currency: input.currency,
    metrics: metrics.map((metric) => (metric.key === 'net_order_value' ? withHistory(metric, history, 'net_order_value') : metric)),
    history: history.table,
  };
}

export const ECOMMERCE_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'ecommerce-channels',
  version: ECOMMERCE_CHANNELS_VERSION,
  evidenceTypes: [CHANNEL_MONTH, COHORT_MONTH, AD_SPEND_MONTH, STOCK_LOT, PNL_LINE],
  compute: ecommerceMetrics,
};
