import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { hotelsMetrics } from './metrics';
import { brandFeesOutpacing, brandFeeYears, checkPerformanceClaims, nearTermUnbudgeted, performanceClaims, pipItems, revparIndexWindow } from './performance';
import { HOTELS_BRAND_FEE_TREND, HOTELS_FRANCHISE_TERM, HOTELS_MANAGEMENT_SURVIVAL, HOTELS_PERFORMANCE_CLAIMS, HOTELS_PIP_DUE } from './rules';

const row = (evidenceType: string, id: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const months = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`);
const operating = months.map((month) => row('hotels.operating_month', `op-${month}`, { month, rooms_available: '1000', rooms_sold: '700', room_revenue: month === '2026-07' ? '140000' : '105000' }));
const benchmark = months.map((month) => row('hotels.benchmark_month', `str-${month}`, { month, revpar: '97', comp_set_revpar: '100' }));
const page = (documentId: string, text: string, pageNumber = 1): PackRulePage => ({ documentId, pageNumber, text });
const deck = page('d1', 'Management presentation (synthetic). The hotel achieved a RevPAR index of 112 against its competitive set. Occupancy averaged 70.0% over the year. ADR was USD 155.00 for the year. The parties have agreed a target closing date of 31 December 2026.');

describe('hotels performance claims (T-166)', () => {
  it('reads RevPAR index, occupancy and ADR claims, never from the agreements or reports', () => {
    const claims = performanceClaims([deck, page('f1', 'Franchise agreement. The RevPAR index of 120 is a target.'), page('s1', 'STR benchmark report. Occupancy was 50%.')]);
    expect(claims.map((claim) => [claim.key, claim.value.toString(), claim.currency])).toEqual([
      ['REVPAR_INDEX', '112', null],
      ['OCCUPANCY', '0.7', null],
      ['ADR', '155', 'USD'],
    ]);
  });

  it('checks each against the trailing twelve months: the index from STR, occupancy and ADR from the operating history', () => {
    const checks = checkPerformanceClaims([...operating, ...benchmark], [deck]);
    expect(checks.map((check) => [check.claim.key, check.status, check.measured?.toFixed(2)])).toEqual([
      ['REVPAR_INDEX', 'CONTRADICTED', '97.00'],
      ['OCCUPANCY', 'VERIFIED', '0.70'],
      ['ADR', 'VERIFIED', '154.17'],
    ]);
    expect(revparIndexWindow(benchmark)?.index?.toFixed(1)).toBe('97.0');
    // Eleven months of STR cannot measure the index.
    expect(checkPerformanceClaims(benchmark.slice(1), [deck])[0]?.status).toBe('UNVERIFIED');
  });

  it('drafts the contradiction (−1) and the verification (+1) into the claims register', () => {
    const proposals = HOTELS_PERFORMANCE_CLAIMS.detect({ evidence: [...operating, ...benchmark], pages: [deck] });
    expect(proposals.map((proposal) => [proposal.title, proposal.direction, proposal.claim?.status])).toEqual([
      ['STR report contradicts the deck: RevPAR index', -1, 'CONTRADICTED'],
      ['Claim verified: Occupancy', 1, 'VERIFIED'],
      ['Claim verified: Average daily rate', 1, 'VERIFIED'],
    ]);
  });
});

describe('hotels agreements and the PIP (T-166)', () => {
  const agreements = [
    row('hotels.agreement', 'a1', { agreement_id: 'MER-2009', kind: 'franchise', counterparty: 'Meridale Hotels (synthetic)', expires_on: '2031-12-31', fee_rate: '0.055', termination_fee: '1000000.00' }),
    row('hotels.agreement', 'a2', { agreement_id: 'CHM-2019', kind: 'management', counterparty: 'Coastline (synthetic)', expires_on: '2034-12-31', fee_rate: '0.03' }),
  ];
  const franchise = page('f1', 'Franchise agreement — Harbourview Hotel (synthetic).', 1);
  const franchise2 = page('f1', '3.1 Term. The franchise agreement MER-2009 expires on 31 December 2029. 21.3 If the Franchisee ends the agreement early, liquidated damages of USD 2,700,000 are payable.', 2);

  it('the agreement’s own expiry and penalty govern over the register; five years or more left is quiet', () => {
    const [found] = HOTELS_FRANCHISE_TERM.detect({ evidence: [...agreements, ...operating], pages: [deck, franchise, franchise2] });
    expect(found).toMatchObject({ title: 'The franchise ends 3 years after closing: Meridale Hotels (synthetic)', direction: -1, severity: 'HIGH' });
    expect(found?.description).toContain('Leaving the brand early costs USD 2,700,000 (as the agreement states)');
    expect(found?.quotes?.map((quote) => quote.quote)).toEqual(expect.arrayContaining([expect.stringMatching(/expires on 31 December 2029/), expect.stringMatching(/target closing date/)]));
    // Without the agreement's sentence, the register's 2031 end is five years after closing: nothing drafted.
    expect(HOTELS_FRANCHISE_TERM.detect({ evidence: [...agreements, ...operating], pages: [deck, franchise] })).toEqual([]);
    // Without documents the check waits.
    expect(HOTELS_FRANCHISE_TERM.detect({ evidence: agreements, pages: [] })).toEqual([]);
  });

  it('PIP items due within twelve months of closing that the budget does not fund are an escrow at the unbudgeted amount', () => {
    const evidence = [
      row('hotels.pip_item', 'p1', { item_id: 'PIP-01', estimated_cost: '1500000.00', due_on: '2027-06-30' }),
      row('hotels.pip_item', 'p2', { item_id: 'PIP-02', estimated_cost: '900000.00', due_on: '2027-09-30' }),
      row('hotels.pip_item', 'p3', { item_id: 'PIP-03', estimated_cost: '800000.00', due_on: '2028-12-31' }),
      row('hotels.capex_budget_line', 'b1', { fiscal_year: '2027', line: 'Lobby', pip_ref: 'PIP-02', amount: '600000.00' }),
    ];
    expect(nearTermUnbudgeted(pipItems(evidence), '2026-12-31').map((item) => [item.itemId, item.unbudgeted.toFixed(2)])).toEqual([
      ['PIP-01', '1500000.00'],
      ['PIP-02', '300000.00'],
    ]);
    const pip = page('f1', 'The current estimate of the PIP is USD 3,200,000.', 2);
    const [found] = HOTELS_PIP_DUE.detect({ evidence, pages: [deck, pip] });
    expect(found).toMatchObject({ direction: -1, pricedRisk: { type: 'ESCROW', currency: 'USD', low: '1800000.00', high: '1800000.00' } });
    expect(found?.title).toBe('PIP due within 12 months of closing and unbudgeted: PIP-01, PIP-02');
  });

  it('management terms that survive a sale are a drag; termination alone is not', () => {
    const management = page('m1', 'Hotel management agreement — Owner and Coastline (synthetic). 12.2 The Owner may terminate on sale. 14.1 The Operator’s right of first offer survives a sale and binds any purchaser.');
    const [found] = HOTELS_MANAGEMENT_SURVIVAL.detect({ evidence: agreements, pages: [management] });
    expect(found).toMatchObject({ title: 'Management agreement terms survive a sale: Coastline (synthetic)', direction: -1, quotes: [expect.objectContaining({ quote: expect.stringMatching(/^14\.1/) })] });
    expect(HOTELS_MANAGEMENT_SURVIVAL.detect({ evidence: agreements, pages: [page('m1', 'Hotel management agreement. 12.2 The Owner may terminate on sale.')] })).toEqual([]);
  });
});

describe('hotels brand fees and figures (T-166)', () => {
  const pnl = (rates: readonly string[]) =>
    rates.flatMap((rate, index) => {
      const year = String(2021 + index);
      const rooms = 10_000_000 * (1 + index * 0.02);
      return [
        row('finance.pnl_line', `r-${year}`, { account: 'Rooms revenue', month: year, amount: rooms.toFixed(2), line_kind: 'REVENUE' }),
        row('finance.pnl_line', `f-${year}`, { account: 'Franchise and brand fees', month: year, amount: (rooms * Number(rate)).toFixed(2), line_kind: 'OPEX' }),
      ];
    });

  it('brand fees ÷ rooms revenue rising every year to 1.15× is a finding; a flat ratio or one year is not', () => {
    expect(brandFeesOutpacing(brandFeeYears(pnl(['0.075', '0.080', '0.086', '0.092', '0.099'])))).toBe(true);
    const [found] = HOTELS_BRAND_FEE_TREND.detect({ evidence: pnl(['0.075', '0.080', '0.086', '0.092', '0.099']), pages: [] });
    expect(found).toMatchObject({ title: 'Brand fees growing faster than rooms revenue, 2021–2025', direction: -1 });
    expect(HOTELS_BRAND_FEE_TREND.detect({ evidence: pnl(['0.08', '0.08', '0.08']), pages: [] })).toEqual([]);
    expect(HOTELS_BRAND_FEE_TREND.detect({ evidence: pnl(['0.099']), pages: [] })).toEqual([]);
  });

  it('the calculator reads the trailing figures, the index, seasonality and names what is missing', () => {
    const report = hotelsMetrics({ evidence: [...operating, ...benchmark], currency: 'USD' } as never);
    const value = (key: string) => report.metrics.find((metric) => metric.key === key);
    expect(value('occupancy')?.value).toBe('0.7000');
    expect(value('revpar_index')?.value).toBe('0.9700');
    expect(value('seasonality')?.value).toBe('0.7500');
    expect(value('pip_total')).toMatchObject({ value: null, needs: ['HOTELS_PIP_SCHEDULE'] });
    expect(value('franchise_months_left')).toMatchObject({ value: null, needs: ['HOTELS_AGREEMENTS', 'HOTELS_OPERATING_HISTORY'] });
  });
});
