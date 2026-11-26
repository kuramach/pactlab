import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { accountRecords, channelReconciliation, cohortValue, inventoryAgeing, stockLots, unitClaims } from './channels';
import {
  ECOMMERCE_INVENTORY_AGEING,
  ECOMMERCE_PLATFORM_OWNERSHIP,
  ECOMMERCE_RETURN_RATE_TREND,
  ECOMMERCE_UNIT_ECONOMICS_CLAIMS,
  ECOMMERCE_UNIT_ECONOMICS_TREND,
} from './rules';

let next = 0;
const row = (evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => {
  next += 1;
  return { id: `e${next}`, evidenceType, sourceRecordId: `e${next}`, canonical };
};
const months = (from: string, count: number) => {
  const out: string[] = [];
  let [year = 0, month = 1] = from.split('-').map(Number);
  for (let index = 0; index < count; index += 1) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) [year, month] = [year + 1, 1];
  }
  return out;
};
/** One consumer channel: 100 orders a month at 100 gross, 10 returned, 40 cost of goods, 10 fulfilment, 5 fees. */
const orders = (from: string, count: number, overrides: (month: string) => Partial<Record<string, string>> = () => ({})) =>
  months(from, count).map((month) =>
    row('ecommerce.channel_month', { month, channel: 'Own web store', platform: 'storefront', account: 'SHOP-1', orders: '100', new_customers: '30', gross_sales: '10000', discounts: '0', returns: '1000', cogs: '3600', fulfilment: '900', channel_fees: '450', ...overrides(month) }),
  );
/** Cohorts of 100 customers, each keeping 25 a month after the first: 1 + 11 × 0.25 = 3.75 orders in twelve months. */
const cohorts = (cohortMonths: readonly string[]) =>
  cohortMonths.flatMap((cohort) => months(cohort, 12).map((month, offset) => row('ecommerce.cohort_month', { first_purchase_month: cohort, month, months_since_first: String(offset), active_customers: offset === 0 ? '100' : '25' })));
const page = (documentId: string, text: string, pageNumber = 1): PackRulePage => ({ documentId, pageNumber, text });

describe('e-commerce channel model (T-164)', () => {
  const evidence = [...orders('2025-10', 12), ...cohorts(['2024-10', '2025-01'])];

  it('recomputes lifetime value on a contribution basis; a claim on gross sales is contradicted and says so', () => {
    const value = cohortValue(evidence);
    // 3.75 orders × (9000 net − 3600 − 900 − 450) ÷ 100 orders = 3.75 × 40.50.
    expect(value?.repeat.ordersPerCustomer.toFixed(2)).toBe('3.75');
    expect(value?.ltvContribution.toFixed(4)).toBe('151.8750');
    expect(value?.ltvGross.toFixed(2)).toBe('375.00');
    const deck = [page('d', 'Investor presentation (synthetic).\n12-month customer lifetime value (LTV): USD 375.\nPaid customer acquisition cost (CAC): USD 20.00.')];
    expect(unitClaims(deck).map((claim) => [claim.key, claim.value.toFixed(2), claim.horizon])).toEqual([
      ['LTV', '375.00', 12],
      ['CAC', '20.00', 12],
    ]);
    const [ltv] = ECOMMERCE_UNIT_ECONOMICS_CLAIMS.detect({ evidence, pages: deck });
    expect(ltv).toMatchObject({ title: 'Claim contradicted: Customer lifetime value', direction: -1, claim: { status: 'CONTRADICTED' } });
    expect(ltv?.description).toContain('computed on gross revenue');
    // No ad-spend export: the CAC claim is a gap, never a guess.
    expect(ECOMMERCE_UNIT_ECONOMICS_CLAIMS.detect({ evidence, pages: deck })[1]).toMatchObject({ direction: 0, claim: { status: 'UNVERIFIED' } });
    // A claim on the contribution basis verifies.
    const fair = [page('d', 'Twelve-month LTV of USD 150 per customer.')];
    expect(ECOMMERCE_UNIT_ECONOMICS_CLAIMS.detect({ evidence, pages: fair })[0]).toMatchObject({ direction: 1, claim: { status: 'VERIFIED' } });
  });

  it('reads who holds each account only from a document headed as an account schedule', () => {
    const schedule = page('s', 'Platform accounts schedule (synthetic).\nAccount SHOP-1, the web store, is registered to the founder personally, not to the company.\nAccount AD-77 is registered to the company.');
    expect(accountRecords([schedule]).map((record) => [record.account, record.owner])).toEqual([
      ['AD-77', 'COMPANY'],
      ['SHOP-1', 'PERSONAL'],
    ]);
    // The paged extracts repeat the rows; they never say who holds an account, and are not read.
    expect(accountRecords([page('x', 'Data-room extracts.\nAccount SHOP-1 is registered to the founder personally.')])).toEqual([]);
    const [found] = ECOMMERCE_PLATFORM_OWNERSHIP.detect({ evidence, pages: [schedule] });
    expect(found).toMatchObject({ title: 'Platform account held personally: Own web store (SHOP-1)', direction: -1, severity: 'CRITICAL' });
    expect(found?.description).toMatch(/^100\.0% of net sales/);
    // The documents govern: before any is read, nothing is drafted.
    expect(ECOMMERCE_PLATFORM_OWNERSHIP.detect({ evidence, pages: [] })).toEqual([]);
  });

  it('ages stock to the report date and prices aged stock as a write-down', () => {
    const lots = [
      row('ecommerce.stock_lot', { sku: 'A', units: '100', unit_cost: '10.00', received_on: '2026-09-01', as_of: '2026-09-30' }),
      row('ecommerce.stock_lot', { sku: 'B', units: '30', unit_cost: '10.00', received_on: '2026-01-15', as_of: '2026-09-30' }),
      // An earlier report is superseded by the latest.
      row('ecommerce.stock_lot', { sku: 'C', units: '999', unit_cost: '10.00', received_on: '2025-01-01', as_of: '2026-06-30' }),
      row('billing.invoice_line', { currency: 'USD', amount: '1', period_start: '2026-09-01' }),
    ];
    const ageing = inventoryAgeing(stockLots(lots));
    expect([ageing?.value.toFixed(2), ageing?.agedValue.toFixed(2), ageing?.agedShare?.toFixed(4)]).toEqual(['1300.00', '300.00', '0.2308']);
    expect(ECOMMERCE_INVENTORY_AGEING.detect({ evidence: lots, pages: [] })[0]?.pricedRisk).toMatchObject({ type: 'PRICE_REDUCTION', currency: 'USD', low: '150.00', high: '300.00' });
  });

  it('reads returns, contribution and acquisition cost by complete year only, and reconciles revenue to the P&L', () => {
    const rising = orders('2023-01', 36, (month) => ({ returns: { '2023': '800', '2024': '1000', '2025': '1200' }[month.slice(0, 4)] ?? '0', cogs: { '2023': '3000', '2024': '3300', '2025': '3600' }[month.slice(0, 4)] ?? '0' }));
    expect(ECOMMERCE_RETURN_RATE_TREND.detect({ evidence: rising, pages: [] })[0]?.title).toBe('Return rate rising, 2023–2025');
    const pnl = (account: string, kind: string, amounts: readonly string[]) => ['2023', '2024', '2025'].map((year, index) => row('finance.pnl_line', { account, month: year, amount: amounts[index] ?? '0', line_kind: kind }));
    const withPnl = [...rising, ...pnl('Own store revenue', 'REVENUE', ['110400', '108000', '105600']), ...pnl('Advertising and marketing', 'OPEX', ['36000', '43200', '50400'])];
    const [cac, contribution] = ECOMMERCE_UNIT_ECONOMICS_TREND.detect({ evidence: withPnl, pages: [] });
    // 360 new customers a year: 100.00, 120.00, 140.00 per new customer; contribution falls as cost of goods rises.
    expect(cac?.title).toBe('Acquisition cost rising every year, 2023–2025');
    expect(cac?.description).toContain('2023 100.00 (36,000 ÷ 360), 2024 120.00');
    expect(contribution?.title).toBe('Contribution margin compressing every year, 2023–2025');
    // Without the P&L the contribution trend still reads; the acquisition-cost one waits for the P&L.
    expect(ECOMMERCE_UNIT_ECONOMICS_TREND.detect({ evidence: rising, pages: [] }).map((proposal) => proposal.title)).toEqual(['Contribution margin compressing every year, 2023–2025']);
    expect(channelReconciliation(withPnl).map((year) => [year.year, year.relative?.toFixed(4)])).toEqual([
      ['2023', '0.0000'],
      ['2024', '0.0000'],
      ['2025', '0.0000'],
    ]);
    // A partial year is never read.
    expect(channelReconciliation(orders('2026-01', 9))).toEqual([]);
  });
});
