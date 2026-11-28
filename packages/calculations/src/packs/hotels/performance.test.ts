import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { hotelsMetrics } from './metrics';
import { benchmarkYear, checkPerformanceClaims, franchiseTermCheck, hotelAddMonths, managementReading, operatingYear, pipChecks, statementSeasonality } from './performance';
import { HOTELS_BRAND_FEE_TREND, HOTELS_FRANCHISE_TERM, HOTELS_MANAGEMENT_CONTRACT, HOTELS_PERFORMANCE_CLAIMS, HOTELS_PIP_SCHEDULE } from './rules';

const MONTHS = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`);
const row = (id: string, evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
// 100 rooms × 30 nights; 70 sold at 200: occupancy 70%, ADR 200, RevPAR 140.
const operating = MONTHS.map((month) => row(`op-${month}`, 'hotels.operating_month', { month, rooms_available: '3000', rooms_sold: '2100', adr: '200', revpar: '140', room_revenue: '420000', fb_revenue: '80000', gross_operating_profit: '175000' }));
// The hotel's RevPAR 97 against the comp set's 100 every month: a RevPAR index of 97.0.
const benchmark = MONTHS.map((month) => row(`str-${month}`, 'hotels.benchmark_month', { month, occupancy: '0.700', adr: '138.57', revpar: '97.00', comp_set_revpar: '100.00', comp_set_occupancy: '0.700' }));
const billing = [row('inv', 'billing.invoice_line', { period_start: '2026-12-01', amount: '1000', currency: 'USD' })];
const page = (documentId: string, text: string, pageNumber = 1): PackRulePage => ({ documentId, pageNumber, text });
const deck = page('deck', 'Investor presentation for the Harbourview Hotel (synthetic). The hotel achieved a RevPAR index of 112 against its competitive set. Occupancy was 70.2% in the twelve months to December 2026. The parties have agreed a target closing date of 31 December 2026. The buyer assumes a hold period of 5 years.');
const franchise = page(
  'franchise',
  'Franchise agreement for the Harbourview Hotel (synthetic). 3.1 The term runs from 1 January 2010 to 31 December 2029. 3.2 If the Franchisee ends this agreement early, it shall pay liquidated damages of USD 2,160,000. 9.1 The Franchisee pays a royalty fee of 5.0% of gross rooms revenue. 21.1 The Franchisor may terminate on transfer without consent.',
);
const pip = page('pip', 'Property improvement plan for the Harbourview Hotel (synthetic). Item 1: guest room soft goods renovation, to be completed by 30 June 2027, estimated at USD 1,450,000. Item 2: lobby and public areas refresh, to be completed by 31 March 2028, estimated at USD 1,150,000.');
const capex = [row('cx-1', 'cre.capex_item', { year: '2028', item: 'Lobby and public areas refresh (PIP item 2)', category: 'public_areas', amount: '1150000', status: 'planned' })];
const management = page(
  'mgmt',
  'Hotel management agreement for the Harbourview Hotel (synthetic). 2.1 The term runs from 1 January 2019 to 31 December 2038. 7.1 The Operator receives a base management fee of 3.0% of gross operating revenue and an incentive fee of 10% of gross operating profit. 12.2 Termination on sale. The Owner may terminate on sale of the hotel on payment of a termination fee equal to three times the prior year’s base management fee. 12.5 This agreement runs with the hotel and binds any purchaser of it.',
);

describe('hotels performance model (T-166)', () => {
  it('reads the trailing twelve months of the operating history and the STR benchmark', () => {
    expect(operatingYear(operating)).toMatchObject({ from: '2026-01', to: '2026-12' });
    expect(operatingYear(operating)?.occupancy?.toFixed(4)).toBe('0.7000');
    expect(operatingYear(operating)?.adr?.toFixed(2)).toBe('200.00');
    expect(operatingYear(operating)?.gopMargin?.toFixed(4)).toBe('0.3500');
    expect(benchmarkYear(benchmark)?.revparIndex?.toFixed(1)).toBe('97.0');
    expect(benchmarkYear(benchmark)?.occupancyIndex?.toFixed(1)).toBe('100.0');
    // No comp-set ADR column: no ADR index, never a guess.
    expect(benchmarkYear(benchmark)?.adrIndex).toBeNull();
    // Eleven months are not a trailing year.
    expect(operatingYear(operating.slice(1))).toBeNull();
  });

  it('a franchise term ending on an anniversary of the closing ends in that year of the hold', () => {
    const check = franchiseTermCheck([...billing, ...operating], [franchise, deck]);
    expect(check).toMatchObject({ holdYear: 3, monthsAfterClosing: 36, hold: { from: '2026-12-31', years: 5, basis: 'EXPECTED_CLOSING' } });
    expect(check?.reading.penalty?.amount?.amount.toString()).toBe('2160000');
    expect(check?.reading.fees.map((fee) => [fee.label, fee.rate.toString()])).toEqual([['Royalty fee', '0.05']]);
    expect(check?.reading.terminationRights.map((quote) => quote.quote)).toEqual(['21.1 The Franchisor may terminate on transfer without consent.']);
    expect(hotelAddMonths('2026-12-31', 6)).toBe('2027-06-30');
    expect(hotelAddMonths('2026-06-30', 6)).toBe('2026-12-31');
  });

  it('PIP items are matched to the capex schedule by the item they name or their element', () => {
    const checks = pipChecks(capex, [pip]);
    expect(checks.map((check) => [check.item.number, check.item.element?.key, check.item.due, check.state])).toEqual([
      ['1', 'guestrooms', '2027-06-30', 'UNBUDGETED'],
      ['2', 'public_areas', '2028-03-31', 'BUDGETED'],
    ]);
  });

  it('performance claims: the RevPAR index contradicted by the STR benchmark, occupancy verified against the operating history', () => {
    const checks = checkPerformanceClaims([...operating, ...benchmark], [deck, franchise]);
    expect(checks.map((check) => [check.claim.key, check.status, check.measured?.toFixed(3)])).toEqual([
      ['REVPAR_INDEX', 'CONTRADICTED', '97.000'],
      ['OCCUPANCY', 'VERIFIED', '0.700'],
    ]);
    // Without the STR benchmark the index claim is a gap, not a defect.
    expect(checkPerformanceClaims(operating, [deck]).map((check) => check.status)).toEqual(['UNVERIFIED', 'VERIFIED']);
  });

  it('reads the management agreement: what binds a purchaser and the cost to end it on a sale', () => {
    const reading = managementReading([management]);
    expect(reading?.term.end).toBe('2038-12-31');
    expect(reading?.baseFee?.rate.toString()).toBe('0.03');
    expect(reading?.incentiveFee?.rate.toString()).toBe('0.1');
    expect(reading?.survives?.quote).toMatch(/binds any purchaser/);
    expect(reading?.terminationOnSale?.multiple?.toString()).toBe('3');
  });

  it('seasonality from the monthly statements, only where twelve months are imported', () => {
    const revenue = [400, 450, 500, 550, 600, 700, 820, 780, 650, 600, 500, 450];
    const lines = MONTHS.map((month, index) => row(`pnl-${month}`, 'finance.pnl_line', { account: 'Rooms revenue', month, amount: String(revenue[index] ?? 0), line_kind: 'REVENUE' }));
    expect(statementSeasonality(lines)).toMatchObject({ peak: ['2026-07', '2026-08'], trough: '2026-01' });
    expect(statementSeasonality(lines)?.ratio.toFixed(2)).toBe('2.00');
    expect(statementSeasonality(lines.slice(1))).toBeNull();
  });

  it('the calculator names the import each missing figure needs', () => {
    const report = hotelsMetrics({ evidence: [], currency: 'USD' } as never);
    expect(report.calculator).toBe('hotels-performance');
    expect(report.metrics.find((metric) => metric.key === 'revpar_index')).toMatchObject({ value: null, needs: ['HOTELS_STR_BENCHMARK'] });
    expect(report.metrics.find((metric) => metric.key === 'statement_seasonality')).toMatchObject({ value: null, needs: ['FINANCIAL_PNL'] });
    const full = hotelsMetrics({ evidence: [...operating, ...benchmark], currency: 'USD' } as never);
    expect(full.metrics.find((metric) => metric.key === 'revpar_index')?.value).toBe('97.0');
    expect(full.metrics.find((metric) => metric.key === 'occupancy')?.value).toBe('0.7000');
  });
});

describe('hotels rules (T-166)', () => {
  it('drafts the franchise term inside the hold, citing the term, the damages and the closing', () => {
    const [found] = HOTELS_FRANCHISE_TERM.detect({ evidence: [...billing, ...operating], pages: [franchise, deck] });
    expect(found).toMatchObject({ title: 'Franchise term ends in year 3 of the hold', direction: -1, pricedRisk: null, domain: 'LEGAL' });
    expect(found?.description).toContain('3 years after the expected closing on 31 December 2026');
    expect(found?.quotes?.map((quote) => quote.documentId)).toEqual(['franchise', 'franchise', 'deck', 'franchise']);
    // Waits for the documents.
    expect(HOTELS_FRANCHISE_TERM.detect({ evidence: operating, pages: [] })).toEqual([]);
  });

  it('prices the near-term unfunded PIP item as an escrow, and waits for the capex schedule', () => {
    const [found] = HOTELS_PIP_SCHEDULE.detect({ evidence: [...billing, ...operating, ...capex], pages: [pip, deck] });
    expect(found).toMatchObject({ direction: -1, pricedRisk: { type: 'ESCROW', currency: 'USD', low: '1450000.00', high: '1450000.00' } });
    expect(found?.description).toContain('due 30 June 2027, 6 months after the closing');
    expect(HOTELS_PIP_SCHEDULE.detect({ evidence: [...billing, ...operating], pages: [pip, deck] })).toEqual([]);
  });

  it('records each performance claim in the claims register', () => {
    const found = HOTELS_PERFORMANCE_CLAIMS.detect({ evidence: [...operating, ...benchmark], pages: [deck] });
    expect(found.map((proposal) => [proposal.title, proposal.direction, proposal.claim?.status])).toEqual([
      ['The STR benchmark contradicts the deck: RevPAR index against the competitive set', -1, 'CONTRADICTED'],
      ['Performance claim verified: Occupancy', 1, 'VERIFIED'],
    ]);
    expect(found[0]?.description).toContain('15.0 index points from the claim');
  });

  it('drafts the management agreement that binds a purchaser, with the cost to end it as arithmetic', () => {
    const [found] = HOTELS_MANAGEMENT_CONTRACT.detect({ evidence: [...billing, ...operating], pages: [management, deck] });
    expect(found).toMatchObject({ title: 'Management agreement survives a sale: runs to 31 December 2038', direction: -1, pricedRisk: null });
    // 3 × 3.0% × 6,000,000 of gross operating revenue.
    expect(found?.description).toContain('≈ 540,000');
  });

  it('drafts franchise and brand fees outpacing rooms revenue only across three years or more', () => {
    const pnl = (year: string, rooms: string, fees: string) => [
      row(`r-${year}`, 'finance.pnl_line', { account: 'Rooms revenue', month: year, amount: rooms, line_kind: 'REVENUE' }),
      row(`f-${year}`, 'finance.pnl_line', { account: 'Franchise royalty fees', month: year, amount: fees, line_kind: 'OPEX' }),
    ];
    const three = [...pnl('2023', '1000000', '75000'), ...pnl('2024', '1010000', '85000'), ...pnl('2025', '1020000', '96000')];
    const [found] = HOTELS_BRAND_FEE_TREND.detect({ evidence: three, pages: [] });
    expect(found).toMatchObject({ title: 'Franchise and brand fees growing faster than rooms revenue, FY2023–FY2025', direction: -1 });
    expect(found?.description).toContain('FY2023 7.5%');
    expect(HOTELS_BRAND_FEE_TREND.detect({ evidence: three.slice(2), pages: [] })).toEqual([]);
  });
});
