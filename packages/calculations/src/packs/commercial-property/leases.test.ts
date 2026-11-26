import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { escalationsBy, leaseDocuments, leaseRentForYear, recoveryYears, rentAt, rentChecks, tenantRents } from './leases';
import { commercialPropertyMetrics } from './metrics';
import { CRE_CONDITION_CAPEX_GAP, CRE_EXPIRY_CLIFF, CRE_OBLIGATIONS, CRE_RECOVERY_SHORTFALL, CRE_RENT_ROLL_VERIFICATION, CRE_RENT_STATEMENT_RECONCILIATION } from './rules';

const row = (id: string, evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const roll = (suite: string, tenant: string, end: string, rent: string) => row(suite, 'cre.lease', { tenant, suite, lease_end: end, monthly_base_rent: rent, monthly_market_rent: rent });
const billed = row('b1', 'billing.invoice_line', { customer_name: 'A', amount: '1', currency: 'USD', period_start: '2026-09-01' });
const pnl = (account: string, year: string, amount: string) => row(`${account}:${year}`, 'finance.pnl_line', { account, month: year, amount, line_kind: /revenue/i.test(account) ? 'REVENUE' : 'OPEX' });
const capex = (item: string, category: string, year: string, amount: string, status: string) => row(`cx:${item}`, 'cre.capex_item', { item, category, year, amount, status });

const leasePage = (suite: string, tenant: string, end: string, rent: string, extra = ''): string =>
  `Lease agreement — ${tenant}, ${suite}, Example Park.\n\nThe term commences on 1 July 2021 and ends on ${end}.\nBase rent is USD ${rent} per month from the commencement date.\nBase rent increases by 3% on each anniversary of the commencement date.\n${extra}`;
const pages: PackRulePage[] = [
  { documentId: 'leases', pageNumber: 1, text: leasePage('Unit 1', 'Anchor Co', '30 June 2027', '10,000.00', 'This is a net lease: the Tenant pays its pro rata share of 60.0% of the recoverable expenses.') },
  {
    documentId: 'leases',
    pageNumber: 2,
    text: leasePage('Unit 2', 'Small Co', '31 March 2031', '5,000.00', 'This is a net lease: the Tenant pays its pro rata share of 30.0% of the recoverable expenses.\nThe Landlord shall pay the Tenant a tenant improvement allowance of USD 50,000 on 31 March 2027.'),
  },
  { documentId: 'om', pageNumber: 1, text: 'Example Park — offering memorandum.\n\nThe expected closing date is 31 December 2026. The business plan assumes a hold period of 5 years.' },
];

describe('commercial property lease model (T-165)', () => {
  it('reads a lease sentence by sentence and recomputes rent with its escalations', () => {
    const [anchor] = leaseDocuments(pages);
    expect(anchor).toMatchObject({ tenant: 'Anchor Co', suite: 'Unit 1', commencement: '2021-07-01', expiry: '2027-06-30', leaseType: 'NET' });
    expect(anchor?.share?.toFixed(3)).toBe('0.600');
    expect(anchor && escalationsBy(anchor, '2026-06-30')).toBe(4);
    expect(anchor && escalationsBy(anchor, '2026-07-01')).toBe(5);
    expect(anchor && rentAt(anchor, '2026-09-30')?.toFixed(2)).toBe('11592.74');
    // Six months at four increases (11,255.09) and six at five (11,592.74).
    expect(anchor && leaseRentForYear(anchor, '2026')?.toFixed(2)).toBe('137086.98');
  });

  it('reads every lease in a text copy whose page breaks are marked mid-page, and gives each allowance to its own tenant', () => {
    const copy: PackRulePage[] = [{ documentId: 'copy', pageNumber: 1, text: `${pages[0]?.text ?? ''}\n---page---\n${pages[1]?.text ?? ''}` }];
    expect(leaseDocuments(copy).map((lease) => [lease.suite, lease.share?.toFixed(3)])).toEqual([
      ['Unit 1', '0.600'],
      ['Unit 2', '0.300'],
    ]);
    expect(CRE_OBLIGATIONS.detect({ evidence: [billed], pages: [...copy, pages[2] as PackRulePage] }).map((proposal) => proposal.title)).toEqual(['Unfunded tenant improvement allowance: Small Co']);
  });

  it('a rent roll above its lease is an overstatement; within half a percent it matches', () => {
    const evidence = [billed, roll('Unit 1', 'Anchor Co', '2027-06-30', '12500.00'), roll('Unit 2', 'Small Co', '2031-03-31', '5796.37')];
    const { checks } = rentChecks(evidence, pages);
    expect(checks.map((check) => check.state)).toEqual(['OVERSTATED', 'MATCHES']);
    const [found, ...rest] = CRE_RENT_ROLL_VERIFICATION.detect({ evidence, pages });
    expect(rest).toEqual([]);
    expect(found).toMatchObject({ title: 'Rent roll overstates rent: Anchor Co', direction: -1, evidenceIds: ['Unit 1'] });
    expect(found?.description).toContain('(7.8%) above the lease');
    // No leases read: nothing to check against.
    expect(CRE_RENT_ROLL_VERIFICATION.detect({ evidence, pages: [] })).toEqual([]);
  });

  it('recoveries short in every statement year are a trend; one year is not drafted', () => {
    const years = ['2024', '2025'];
    const evidence = years.flatMap((year) => [pnl('Base rent revenue', year, '100000'), pnl('Expense recovery revenue', year, '70000'), pnl('Real estate taxes', year, '50000'), pnl('Insurance', year, '50000'), pnl('Property management fees', year, '9000')]);
    const { years: read } = recoveryYears(evidence, pages);
    // 90% of the leases' shares of the 100,000 pool, against 70,000 billed.
    expect(read.map((year) => [year.year, year.recoverable.toFixed(2), year.shortfall.toFixed(2), year.short])).toEqual([
      ['2024', '90000.00', '20000.00', true],
      ['2025', '90000.00', '20000.00', true],
    ]);
    expect(CRE_RECOVERY_SHORTFALL.detect({ evidence, pages }).map((proposal) => proposal.title)).toEqual(['NNN recoveries short of the leases every year, 2024–2025']);
    expect(CRE_RECOVERY_SHORTFALL.detect({ evidence: evidence.filter((entry) => entry.canonical['month'] === '2025'), pages })).toEqual([]);
  });

  it('statement rent that does not tie to the leases is drafted only once every suite has a lease', () => {
    const evidence = [billed, roll('Unit 1', 'Anchor Co', '2027-06-30', '11592.74'), roll('Unit 2', 'Small Co', '2031-03-31', '5796.37'), pnl('Base rent revenue', '2025', '150000')];
    const [found] = CRE_RENT_STATEMENT_RECONCILIATION.detect({ evidence, pages });
    expect(found?.title).toBe('Statement rent does not tie to the leases, 2025');
    expect(CRE_RENT_STATEMENT_RECONCILIATION.detect({ evidence: [...evidence, roll('Unit 3', 'No Lease Co', '2030-01-31', '1000.00')], pages })).toEqual([]);
  });

  it('obligations due after the closing are priced; earlier ones are the seller’s', () => {
    const evidence = [billed, capex('Paving', 'parking', '2027', '20000.00', 'committed'), capex('Old lobby', 'interior', '2025', '9000.00', 'committed')];
    const found = CRE_OBLIGATIONS.detect({ evidence, pages });
    expect(found.map((proposal) => [proposal.title, proposal.pricedRisk?.low])).toEqual([
      ['Unfunded tenant improvement allowance: Small Co', '50000.00'],
      ['Committed capex outstanding: Paving', '20000.00'],
    ]);
  });

  it('a dominant tenant expiring in year 1 of the hold is a cliff; it waits for the documents', () => {
    const evidence = [billed, roll('Unit 1', 'Anchor Co', '2027-06-30', '11592.74'), roll('Unit 2', 'Small Co', '2031-03-31', '5796.37')];
    const { hold, tenants } = tenantRents(evidence, pages);
    expect(hold).toMatchObject({ from: '2026-12-31', basis: 'EXPECTED_CLOSING', years: 5, yearsStated: true });
    expect(tenants.map((tenant) => [tenant.tenant, tenant.holdYear])).toEqual([
      ['Anchor Co', 1],
      ['Small Co', 5],
    ]);
    expect(CRE_EXPIRY_CLIFF.detect({ evidence, pages }).map((proposal) => proposal.title)).toEqual(['Lease-expiry cliff: Anchor Co (66.7% of rent) expires in year 1 of the hold']);
    expect(CRE_EXPIRY_CLIFF.detect({ evidence, pages: [] })).toEqual([]);
  });

  it('a condition item no capex project covers is priced as remediation; no schedule, no draft', () => {
    const report: PackRulePage[] = [
      { documentId: 'pca', pageNumber: 1, text: 'Property condition assessment — Example Park.\n\nRoof replacement is recommended within two years at an estimated cost of USD 400,000. Rooftop HVAC units are recommended for replacement at an estimated cost of USD 90,000.' },
    ];
    const evidence = [capex('HVAC replacement', 'hvac', '2028', '90000.00', 'planned')];
    expect(CRE_CONDITION_CAPEX_GAP.detect({ evidence, pages: report }).map((proposal) => [proposal.title, proposal.pricedRisk?.type, proposal.pricedRisk?.high])).toEqual([['Condition item missing from the capex schedule: Roof', 'REMEDIATION_COST', '400000.00']]);
    expect(CRE_CONDITION_CAPEX_GAP.detect({ evidence: [], pages: report })).toEqual([]);
  });

  it('the calculator reads the imports and names what is missing', () => {
    const report = commercialPropertyMetrics({ currency: 'USD', evidence: [billed, roll('Unit 1', 'Anchor Co', '2027-06-30', '600'), roll('Unit 2', 'Small Co', '2031-03-31', '400')] });
    const byKey = Object.fromEntries(report.metrics.map((metric) => [metric.key, metric]));
    expect(byKey['in_place_rent']?.value).toBe('12000.00');
    expect(byKey['largest_tenant_share']?.value).toBe('0.6000');
    expect(byKey['rent_expiring_24m']?.value).toBe('0.6000');
    expect(byKey['committed_capex']).toMatchObject({ value: null, needs: ['CRE_CAPEX_SCHEDULE'] });
  });
});
