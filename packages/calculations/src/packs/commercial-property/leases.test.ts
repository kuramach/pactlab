import { describe, expect, it } from 'vitest';
import { METRIC_CALCULATORS } from '../calculators';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { anniversariesBy, conditionChecks, holdYearOf, leaseReadings, persistentShortfall, recoveryYears, rentChecks, rentDueOn, statementRent } from './leases';
import { CRE_CONDITION_CAPEX, CRE_OBLIGATIONS, CRE_RECOVERY_RECONCILIATION, CRE_RENT_CLIFF, CRE_RENT_ROLL_VERIFICATION } from './rules';

const row = (id: string, evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const suite = (suiteId: string, tenant: string, rent: string, end: string) =>
  row(suiteId, 'cre.lease', { tenant, suite: suiteId, sqft: '1000', lease_start: '2021-07-01', lease_end: end, monthly_base_rent: rent, monthly_market_rent: rent });
const billed = row('bill', 'billing.invoice_line', { customer_name: 'Anchor Co (synthetic)', amount: '1', currency: 'USD', period_start: '2026-09-01' });
const page = (documentId: string, text: string, pageNumber = 1): PackRulePage => ({ documentId, pageNumber, text });
const lease = (documentId: string, tenant: string, lines: string) =>
  page(documentId, `Lease agreement for Unit 1 at Example Park between Landlord Co as landlord and ${tenant} as tenant.\n\n${lines}`);
const anchorLease = lease(
  'l1',
  'Anchor Co (synthetic)',
  'The term runs from 1 July 2021 to 30 June 2027.\nThe initial base rent is USD 10,000.00 per month.\nBase rent increases by 3% on each anniversary of the commencement date.\nThe lease is triple net: the tenant pays its proportionate share of 60.00% of the recoverable expenses.\nThe landlord shall pay a tenant improvement allowance of USD 100,000.00, of which USD 40,000.00 remains unpaid.',
);
const smallLease = lease('l2', 'Small Co (synthetic)', 'The term runs from 1 July 2021 to 30 June 2030.\nThe initial base rent is USD 5,000.00 per month.\nBase rent is fixed for the term.\nThis is a modified gross lease.');

describe('commercial property lease model (T-165)', () => {
  it('reads a lease sentence by sentence and steps the rent up on each anniversary, to the cent', () => {
    const [reading] = leaseReadings([anchorLease], ['Anchor Co (synthetic)']);
    expect(reading).toMatchObject({ tenant: 'Anchor Co (synthetic)', start: '2021-07-01', end: '2027-06-30', recovery: 'NNN' });
    expect(reading?.share?.toString()).toBe('0.6');
    expect(reading?.tiOutstanding?.amount.toString()).toBe('40000');
    expect(anniversariesBy('2021-07-01', '2026-06-30')).toBe(4);
    expect(anniversariesBy('2021-07-01', '2026-07-01')).toBe(5);
    // 10,000 × 1.03 five times, rounded at each step: 10,300 → 10,609 → 10,927.27 → 11,255.09 → 11,592.74.
    expect(rentDueOn(reading as NonNullable<typeof reading>, '2026-09-30')?.toFixed(2)).toBe('11592.74');
    expect(rentDueOn(reading as NonNullable<typeof reading>, '2027-07-01')).toBeNull();
    const [gross] = leaseReadings([smallLease], ['Small Co (synthetic)']);
    expect(gross).toMatchObject({ recovery: 'GROSS', share: null });
    expect(gross?.escalation?.isZero()).toBe(true);
    // The extracts' copy of a lease, or an abstract, is never read as a lease.
    expect(leaseReadings([page('x', 'Lease abstract — Anchor Co (synthetic). The term runs from 1 July 2021 to 30 June 2027.')], ['Anchor Co (synthetic)'])).toEqual([]);
  });

  it('flags a rent roll above the lease, records a tenant with no lease, and checks the statements against the leases', () => {
    const evidence = [suite('U1', 'Anchor Co (synthetic)', '12000.00', '2027-06-30'), suite('U2', 'Small Co (synthetic)', '5000.00', '2030-06-30'), billed];
    const checks = rentChecks(evidence, [anchorLease, smallLease], '2026-09-30');
    expect(checks.map((check) => check.state)).toEqual(['OVERSTATED', 'MATCHES']);
    const [over, , missing] = CRE_RENT_ROLL_VERIFICATION.detect({ evidence, pages: [anchorLease] });
    expect(over).toMatchObject({ title: 'Rent roll overstates rent against the leases: 1 tenant', direction: -1, pricedRisk: null });
    expect(over?.description).toContain('the rent roll says 12,000.00 a month; the lease makes 11,592.74 due on 30 September 2026');
    expect(missing ?? CRE_RENT_ROLL_VERIFICATION.detect({ evidence, pages: [anchorLease] })[1]).toMatchObject({ direction: 0, title: '1 rent-roll tenant has no lease that states the rent' });
    // Statements above the leases are their own drag; with every lease on file the year is recomputed.
    const pnl = row('p1', 'finance.pnl_line', { account: 'Base rent revenue', month: '2025', amount: '300000.00', line_kind: 'REVENUE' });
    const years = statementRent([...evidence, pnl], checks);
    expect(years[0]).toMatchObject({ year: '2025' });
    // 2025: six months at 10,927.27 (three anniversaries), six at 11,255.09, and 5,000 fixed every month.
    expect(years[0]?.leases.toFixed(2)).toBe('193094.16');
    const proposals = CRE_RENT_ROLL_VERIFICATION.detect({ evidence: [...evidence, pnl], pages: [anchorLease, smallLease] });
    expect(proposals.map((proposal) => proposal.title)).toEqual(['Rent roll overstates rent against the leases: 1 tenant', 'Rental income in the statements exceeds the leases, FY2025']);
    // Nothing before the documents are read.
    expect(CRE_RENT_ROLL_VERIFICATION.detect({ evidence, pages: [] })).toEqual([]);
  });

  it('recoveries: a shortfall every year for three years is persistent; two years or a gross-only park is not drafted', () => {
    const cam = (year: string, expenses: string, recoveries: string) => row(`c${year}`, 'cre.cam_category', { year, category: 'Repairs', expenses, recoveries });
    const evidence = [suite('U1', 'Anchor Co (synthetic)', '11592.74', '2027-06-30'), cam('2023', '1000', '500'), cam('2024', '1000', '500'), cam('2025', '1000', '500')];
    // 60% recoverable under the one NNN lease: 600 recoverable, 500 billed, 100 short (16.7%).
    expect(persistentShortfall(recoveryYears(evidence, leaseReadings([anchorLease], ['Anchor Co (synthetic)'])[0]?.share ?? null)).map((year) => year.year)).toEqual(['2023', '2024', '2025']);
    const [found] = CRE_RECOVERY_RECONCILIATION.detect({ evidence, pages: [anchorLease] });
    expect(found).toMatchObject({ title: 'NNN recoveries short of the leases in every year, 2023–2025', direction: -1 });
    expect(found?.description).toContain('2025: 1,000 recoverable expenses, 600 recoverable under the leases, 500 billed, 100 short (16.7%)');
    expect(CRE_RECOVERY_RECONCILIATION.detect({ evidence: evidence.filter((entry) => entry.id !== 'c2023'), pages: [anchorLease] })).toEqual([]);
    expect(CRE_RECOVERY_RECONCILIATION.detect({ evidence, pages: [smallLease] })).toEqual([]);
  });

  it('the cliff measures from the stated closing, and a dominant tenant ending late in the hold is not one', () => {
    const memo = page('m', 'Offering memorandum.\nThe parties have agreed a target closing date of 31 December 2026.\nThe plan assumes a hold period of 5 years.');
    const evidence = [suite('U1', 'Anchor Co (synthetic)', '12000.00', '2027-06-30'), suite('U2', 'Small Co (synthetic)', '5000.00', '2030-06-30'), billed];
    const [cliff] = CRE_RENT_CLIFF.detect({ evidence, pages: [anchorLease, memo] });
    expect(cliff?.title).toBe('Rent cliff: Anchor Co (synthetic) (70.6% of rent) expires in year 1 of the hold');
    expect(cliff?.description).toContain('6 months after the expected closing on 31 December 2026');
    expect(holdYearOf('2026-12-30', { from: '2026-12-31', basis: 'EXPECTED_CLOSING', closingQuote: null, years: 5, yearsStated: true, to: '2031-12-31' })).toBe(0);
    expect(CRE_RENT_CLIFF.detect({ evidence: [suite('U1', 'Anchor Co (synthetic)', '12000.00', '2030-06-30'), billed], pages: [memo] })).toEqual([]);
  });

  it('condition items against the capex schedule: omitted, under-budgeted or covered; obligations priced at their sum', () => {
    const pca = page('pca', 'Property condition assessment of Example Park (synthetic).\nRoof: replacement is recommended within two years at an estimated cost of USD 500,000.\nHVAC: replacement is recommended in 2026 at an estimated cost of USD 400,000.\nPaving: resurfacing is recommended at an estimated cost of USD 100,000.');
    const capex = (id: string, item: string, category: string, amount: string, status: string) => row(id, 'cre.capex_item', { year: '2026', item, category, amount, status });
    const evidence = [suite('U1', 'Anchor Co (synthetic)', '11592.74', '2027-06-30'), billed, capex('k1', 'Rooftop unit replacement', 'hvac', '300000.00', 'committed'), capex('k2', 'Car park resurfacing', 'paving', '120000.00', 'planned')];
    expect(conditionChecks(evidence, [pca]).map((check) => [check.item.element.key, check.state])).toEqual([
      ['roof', 'OMITTED'],
      ['hvac', 'UNDER_BUDGETED'],
      ['paving', 'COVERED'],
    ]);
    const [roof, hvac] = CRE_CONDITION_CAPEX.detect({ evidence, pages: [pca] });
    expect(roof).toMatchObject({ direction: -1, pricedRisk: { type: 'REMEDIATION_COST', currency: 'USD', low: '500000.00' } });
    expect(hvac).toMatchObject({ title: 'HVAC work under-budgeted in the seller’s capex schedule', pricedRisk: { low: '100000.00' } });
    // No schedule imported: absence, nothing drafted.
    expect(CRE_CONDITION_CAPEX.detect({ evidence: evidence.slice(0, 2), pages: [pca] })).toEqual([]);
    const [owed] = CRE_OBLIGATIONS.detect({ evidence, pages: [anchorLease] });
    expect(owed).toMatchObject({ direction: -1, pricedRisk: { type: 'PRICE_REDUCTION', currency: 'USD', low: '340000.00', high: '340000.00' } });
  });

  it('the calculator reads the imports and names what is missing', () => {
    const calculator = METRIC_CALCULATORS['cre-leases'];
    const empty = calculator?.compute({ currency: 'USD', evidence: [] } as never) as { metrics: { key: string; value: string | null; needs?: readonly string[] }[] };
    expect(empty.metrics.find((metric) => metric.key === 'in_place_rent')).toMatchObject({ value: null, needs: ['CRE_RENT_ROLL'] });
    expect(empty.metrics.find((metric) => metric.key === 'committed_capex')?.needs).toEqual(['CRE_CAPEX_SCHEDULE']);
    const report = calculator?.compute({ currency: 'USD', evidence: [suite('U1', 'Anchor Co (synthetic)', '12000.00', '2027-06-30'), suite('U2', 'Small Co (synthetic)', '5000.00', '2030-06-30'), billed] } as never) as { metrics: { key: string; value: string | null }[] };
    expect(report.metrics.find((metric) => metric.key === 'in_place_rent')?.value).toBe('204000.00');
    expect(report.metrics.find((metric) => metric.key === 'largest_tenant_share')?.value).toBe('0.7059');
    expect(report.metrics.find((metric) => metric.key === 'rent_expiring_12m')?.value).toBe('0.7059');
  });
});
