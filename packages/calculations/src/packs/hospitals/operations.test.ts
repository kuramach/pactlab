import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { HOSPITALS_METRICS_CALCULATOR } from './metrics';
import { capexYears, censusWindow, costReportReconciliations, costReports, deckFigures, departmentClusters, hospitalPayerContracts, medicalStaff, payerAgreements, qualityClaims, qualityReports, staffStatuses } from './operations';
import {
  HOSPITALS_COST_REPORT_RECONCILIATION,
  HOSPITALS_MEDICAL_STAFF,
  HOSPITALS_PAYER_CONTRACTS,
  HOSPITALS_PLANT_CAPEX,
  HOSPITALS_PNL_EXPENSE_OUTPACING,
  HOSPITALS_PNL_MARGIN_DRIFT,
  HOSPITALS_QUALITY_CLAIMS,
  HOSPITALS_RULES,
} from './rules';

const row = (id: string, evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const page = (documentId: string, text: string, pageNumber = 1): PackRulePage => ({ documentId, pageNumber, text });
const LAST12 = Array.from({ length: 12 }, (_, index) => `${index < 3 ? 2025 : 2026}-${String(((index + 9) % 12) + 1).padStart(2, '0')}`);

const COST_REPORT = page('cr', 'Medicare cost report summary, fiscal year 2025 (synthetic).\n\nLicensed beds: 220.\nInpatient days: 53,290.\nOccupancy of licensed beds: 66.4%.\nMedicare share of inpatient days: 41.0%.\nTotal operating costs: USD 36,200,000.');
const deck = (occupancy: string, stars = 'four-star') =>
  page(
    'deck',
    `Management presentation (synthetic). Occupancy averaged ${occupancy} of licensed beds in fiscal year 2025. Medicare accounts for 41% of inpatient days. The hospital runs a modern plant, with the main building fully renovated in 2016. The hospital holds a ${stars} overall rating from the national programme (synthetic). The parties have agreed a target closing date of 31 December 2026.`,
  );
const QUALITY = page('quality', 'Hospital quality reporting summary, 2026 release (synthetic). Overall star rating: 4 stars.');
const CONDITION = page('pca', 'Property condition assessment of the main hospital campus (synthetic). The central plant chillers are past their expected service life. Deferred maintenance is estimated at USD 6,800,000 over three years.');
const agreement = (id: string, payer: string, ends: string, renewal: string) =>
  page(id, `Hospital services agreement between ${payer} (synthetic) and the hospital operator (synthetic). The term began on 1 August 2022 and ends on ${ends}. ${payer} pays inpatient stays at a case rate per DRG. ${renewal}`);

function payerMix(): PackRuleEvidence[] {
  return LAST12.flatMap((month) => [
    row(`${month}:gov`, 'hospitals.payer_month', { month, payer: 'Government programme A (synthetic)', net_revenue: '1800000.00' }),
    row(`${month}:key`, 'hospitals.payer_month', { month, payer: 'Commercial plan Keystone (synthetic)', net_revenue: '600000.00' }),
    row(`${month}:riv`, 'hospitals.payer_month', { month, payer: 'Commercial plan Riverbend (synthetic)', net_revenue: '300000.00' }),
  ]);
}
const census = () => LAST12.map((month) => row(`c:${month}`, 'hospitals.census_month', { month, service_line: 'Cardiology', admissions: '300', patient_days: '1200' }));
const staff = (ref: string, department: string, privileges: string, licence = '2028-01-01', privilegeStatus = 'active') =>
  row(ref, 'hospitals.medical_staff', { staff_ref: ref, department, role: 'surgeon', licence_status: 'active', licence_expires_on: licence, privilege_status: privilegeStatus, privileges_expire_on: privileges });
const pnl = (lines: Record<string, [string, string[]]>, years = ['2023', '2024', '2025']) =>
  Object.entries(lines).flatMap(([account, [kind, amounts]]) => years.map((year, index) => row(`${account}:${year}`, 'finance.pnl_line', { account, line_kind: kind, month: year, amount: amounts[index] ?? '0' })));
const PNL = pnl({
  'Net patient service revenue': ['REVENUE', ['35000000', '37100000', '39400000']],
  'Cost of care: staff salaries and benefits': ['COGS', ['17500000', '18550000', '19700000']],
  'Capital-related costs: plant and equipment': ['OPEX', ['2135000', '1595300', '1024400']],
  'General and administrative': ['OPEX', ['14000000', '15000000', '15475600']],
});

describe('hospitals operations model (T-162)', () => {
  it('reads the cost report: beds, days, occupancy, payer shares and costs, by fiscal year', () => {
    const [report] = costReports([COST_REPORT, deck('82%')]);
    expect(report).toMatchObject({ documentId: 'cr', fiscalYear: '2025' });
    expect(report?.beds?.value.toFixed(0)).toBe('220');
    expect(report?.patientDays?.value.toFixed(0)).toBe('53290');
    expect(report?.figures.map((figure) => [figure.key, figure.value.toFixed(1), figure.currency])).toEqual([
      ['OCCUPANCY', '66.4', null],
      ['MEDICARE_SHARE', '41.0', null],
      ['TOTAL_COSTS', '36200000.0', 'USD'],
    ]);
    // Only the cost report is read as one; the deck's figures are read as claims.
    expect(costReports([deck('82%')])).toEqual([]);
    expect(deckFigures([COST_REPORT, deck('82%')]).map((figure) => [figure.key, figure.value.toFixed(0), figure.year])).toEqual([
      ['OCCUPANCY', '82', '2025'],
      ['MEDICARE_SHARE', '41', null],
    ]);
  });

  it('reconciles the cost report’s costs to the P&L for its fiscal year', () => {
    const [entry] = costReportReconciliations(PNL, [COST_REPORT]);
    expect(entry).toMatchObject({ fiscalYear: '2025', agrees: true });
    expect(entry?.pnlCosts.toFixed(0)).toBe('36200000');
    const off = pnl({ 'Net patient service revenue': ['REVENUE', ['0', '0', '39400000']], 'General and administrative': ['OPEX', ['0', '0', '38000000']] });
    expect(costReportReconciliations(off, [COST_REPORT])[0]).toMatchObject({ agrees: false });
  });

  it('reads the payer agreements for the payers in the mix, and measures their terms from the stated closing', () => {
    const pages = [deck('82%'), agreement('k', 'Commercial plan Keystone', '31 July 2027', 'Rates are renegotiated on renewal.'), agreement('r', 'Commercial plan Riverbend', '30 June 2027', 'The agreement renews automatically for one-year terms unless either party gives notice.')];
    expect(payerAgreements(pages, ['Commercial plan Keystone (synthetic)']).map((entry) => [entry.payer, entry.expiresOn, entry.autoRenews, entry.rateBasis?.quote])).toEqual([
      ['Commercial plan Keystone (synthetic)', '2027-07-31', false, 'Commercial plan Keystone pays inpatient stays at a case rate per DRG.'],
    ]);
    const { from, payers } = hospitalPayerContracts(payerMix(), pages);
    expect(from).toMatchObject({ date: '2026-12-31', basis: 'EXPECTED_CLOSING' });
    expect(payers.map((status) => [status.payer.payer, status.state, status.monthsAfterClose, status.largestContracted])).toEqual([
      ['Government programme A (synthetic)', 'NOT_CONTRACTED', null, false],
      ['Commercial plan Keystone (synthetic)', 'EXPIRES_WITHIN_YEAR', 7, true],
      ['Commercial plan Riverbend (synthetic)', 'RENEWS', 6, false],
    ]);
  });

  it('reads the medical staff: departments lapsing together, privileges due, licences expired', () => {
    const rows = medicalStaff([
      ...['MS-1', 'MS-2', 'MS-3'].map((ref) => staff(ref, 'Orthopaedics', '2026-06-30')),
      ...['MS-4', 'MS-5', 'MS-6'].map((ref) => staff(ref, 'Cardiology', '2026-11-15')),
      staff('MS-7', 'Cardiology', '2026-06-30', '2026-05-01'),
      ...['MS-8', 'MS-9', 'MS-10'].map((ref) => staff(ref, 'Radiology', '2026-06-30', '2028-01-01', 'reappointed')),
    ]);
    expect(departmentClusters(rows, '2026-09-30').map((cluster) => [cluster.department, cluster.date, cluster.state, cluster.staff.length])).toEqual([
      ['Cardiology', '2026-11-15', 'DUE', 3],
      ['Orthopaedics', '2026-06-30', 'LAPSED', 3],
    ]);
    const statuses = staffStatuses(rows, [page('v', 'MS-4: medical licence, Ohio — expired on 1 August 2026.')], '2026-09-30');
    expect(statuses.filter((status) => status.licenceExpired).map((status) => status.row.staffRef)).toEqual(['MS-4', 'MS-7']);
    expect(statuses.filter((status) => status.privilegesLapsed).map((status) => status.row.staffRef)).toEqual(['MS-7', 'MS-1', 'MS-2', 'MS-3']);
  });

  it('reads capital spend by year, the census window, and the quality reporting', () => {
    expect(capexYears(PNL).years.map((year) => [year.year, year.ratio?.toFixed(3)])).toEqual([
      ['2023', '0.061'],
      ['2024', '0.043'],
      ['2025', '0.026'],
    ]);
    expect(censusWindow(census())).toMatchObject({ from: '2025-10', to: '2026-09', missing: [] });
    expect(censusWindow(census())?.averageLengthOfStay?.toFixed(1)).toBe('4.0');
    expect(qualityReports([QUALITY])[0]?.stars?.value).toBe(4);
    expect(qualityClaims([QUALITY, deck('82%')]).map((claim) => claim.stars)).toEqual([4]);
  });
});

describe('hospitals rules (T-162)', () => {
  it('contradicts an overstated occupancy, verifies the Medicare share, and reports gaps without a cost report', () => {
    const found = HOSPITALS_COST_REPORT_RECONCILIATION.detect({ evidence: PNL, pages: [COST_REPORT, deck('82%')] });
    expect(found.map((proposal) => [proposal.title, proposal.direction, proposal.claim?.status])).toEqual([
      ['The cost report contradicts the deck: Occupancy of licensed beds', -1, 'CONTRADICTED'],
      ['Claim verified against the cost report: Medicare share of inpatient days', 1, 'VERIFIED'],
    ]);
    expect(found[0]?.description).toContain('66.4%');
    expect(found[0]?.quotes?.map((quote) => quote.quote)).toContain('Occupancy of licensed beds: 66.4%.');
    // No cost report: every deck figure is a gap. Within 1–3 points: nothing.
    expect(HOSPITALS_COST_REPORT_RECONCILIATION.detect({ evidence: [], pages: [deck('82%')] }).map((proposal) => [proposal.direction, proposal.claim?.status])).toEqual([
      [0, 'UNVERIFIED'],
      [0, 'UNVERIFIED'],
    ]);
    expect(HOSPITALS_COST_REPORT_RECONCILIATION.detect({ evidence: PNL, pages: [COST_REPORT, deck('68.5%')] }).map((proposal) => proposal.key)).toEqual(['MEDICARE_SHARE:verified']);
  });

  it('drafts the largest payer contract ending inside a year of closing, not one that renews', () => {
    const pages = [deck('82%'), agreement('k', 'Commercial plan Keystone', '31 July 2027', 'Rates are renegotiated on renewal.'), agreement('r', 'Commercial plan Riverbend', '30 June 2027', 'The agreement renews automatically for one-year terms unless either party gives notice.')];
    const found = HOSPITALS_PAYER_CONTRACTS.detect({ evidence: payerMix(), pages });
    expect(found.map((proposal) => [proposal.title, proposal.direction, proposal.severity])).toEqual([['Largest payer contract ends 7 months after closing: Commercial plan Keystone (synthetic)', -1, 'HIGH']]);
    expect(found[0]?.evidenceIds).toHaveLength(12);
    expect(found[0]?.quotes?.map((quote) => quote.quote)).toContain('The parties have agreed a target closing date of 31 December 2026.');
    expect(HOSPITALS_PAYER_CONTRACTS.detect({ evidence: payerMix(), pages: [deck('82%'), agreement('k', 'Commercial plan Keystone', '31 July 2029', 'Rates are renegotiated on renewal.')] })).toEqual([]);
  });

  it('drafts a department whose privileges lapsed together (−1), one falling due (0) and expired licences (−1)', () => {
    const evidence = [
      ...census(),
      ...['MS-1', 'MS-2', 'MS-3'].map((ref) => staff(ref, 'Orthopaedics', '2026-06-30')),
      ...['MS-4', 'MS-5', 'MS-6'].map((ref) => staff(ref, 'Cardiology', '2026-11-15')),
      staff('MS-7', 'Cardiology', '2027-06-30', '2026-05-01'),
    ];
    expect(HOSPITALS_MEDICAL_STAFF.detect({ evidence, pages: [] }).map((proposal) => [proposal.title, proposal.direction])).toEqual([
      ['Cardiology: clinical privileges for 3 medical staff fall due together on 2026-11-15', 0],
      ['Orthopaedics: clinical privileges lapsed together for 3 medical staff on 2026-06-30', -1],
      ['1 medical-staff licence expired at 2026-09-30', -1],
    ]);
    // Two sharing a date is not a department lapsing together.
    expect(HOSPITALS_MEDICAL_STAFF.detect({ evidence: [...census(), staff('MS-1', 'Orthopaedics', '2026-06-30'), staff('MS-2', 'Orthopaedics', '2026-06-30')], pages: [] })).toEqual([]);
  });

  it('drafts capital spend falling across the years against a modern-plant claim, priced at the stated deferred maintenance', () => {
    const [found] = HOSPITALS_PLANT_CAPEX.detect({ evidence: PNL, pages: [deck('82%'), CONDITION] });
    expect(found).toMatchObject({ title: 'Capital spend fell from 6.1% to 2.6% of revenue, 2023–2025, against a “modern plant” claim', direction: -1, severity: 'HIGH' });
    expect(found?.pricedRisk).toMatchObject({ type: 'REMEDIATION_COST', currency: 'USD', low: '6800000.00', high: '6800000.00' });
    expect(found?.evidenceIds).toHaveLength(3);
    expect(found?.quotes?.map((quote) => quote.quote)).toEqual([
      'The hospital runs a modern plant, with the main building fully renovated in 2016.',
      'The central plant chillers are past their expected service life.',
      'Deferred maintenance is estimated at USD 6,800,000 over three years.',
    ]);
    // A single year reads one year: nothing to trend. A steady ratio: nothing.
    expect(HOSPITALS_PLANT_CAPEX.detect({ evidence: PNL.filter((entry) => entry.canonical['month'] === '2025'), pages: [] })).toEqual([]);
    const steady = pnl({ 'Net patient service revenue': ['REVENUE', ['100', '100', '100']], 'Capital-related costs: plant and equipment': ['OPEX', ['6', '6', '5']] });
    expect(HOSPITALS_PLANT_CAPEX.detect({ evidence: steady, pages: [] })).toEqual([]);
    // Falling capex raises the margin: the shared trend rules stay quiet.
    expect(HOSPITALS_PNL_MARGIN_DRIFT.detect({ evidence: PNL, pages: [] })).toEqual([]);
    expect(HOSPITALS_PNL_EXPENSE_OUTPACING.detect({ evidence: PNL, pages: [] })).toEqual([]);
  });

  it('maps the deck’s star rating to the quality reporting: verified, contradicted, or unverified with none', () => {
    expect(HOSPITALS_QUALITY_CLAIMS.detect({ evidence: [], pages: [deck('82%'), QUALITY] }).map((proposal) => [proposal.title, proposal.direction, proposal.claim?.status])).toEqual([
      ['Quality claim verified: overall star rating', 1, 'VERIFIED'],
    ]);
    expect(HOSPITALS_QUALITY_CLAIMS.detect({ evidence: [], pages: [deck('82%', 'five-star'), QUALITY] }).map((proposal) => [proposal.direction, proposal.claim?.status])).toEqual([[-1, 'CONTRADICTED']]);
    expect(HOSPITALS_QUALITY_CLAIMS.detect({ evidence: [], pages: [deck('82%')] }).map((proposal) => [proposal.direction, proposal.claim?.status])).toEqual([[0, 'UNVERIFIED']]);
  });

  it('every rule is versioned and named for the pack; the calculator reports what the exports hold', () => {
    expect(HOSPITALS_RULES.every((rule) => rule.id.startsWith('hospitals-') && rule.version === '1')).toBe(true);
    const report = HOSPITALS_METRICS_CALCULATOR.compute({ currency: 'USD', evidence: [...payerMix(), ...census(), ...PNL, staff('MS-1', 'Orthopaedics', '2026-06-30')] });
    expect(report).toMatchObject({ calculator: 'hospitals-operations', version: 'hospitals-operations-1' });
    const byKey = Object.fromEntries(report.metrics.map((metric) => [metric.key, metric]));
    expect(byKey['net_revenue']).toMatchObject({ value: '32400000.00' });
    expect(byKey['largest_payer_share']).toMatchObject({ value: '0.6667', label: 'Largest payer’s share of net revenue (Government programme A (synthetic))' });
    expect(byKey['capex_ratio']).toMatchObject({ value: '0.0260', label: 'Capital spend on plant and equipment ÷ revenue (2025)' });
    expect(byKey['privileges_lapsed']).toMatchObject({ value: '1' });
    expect(HOSPITALS_METRICS_CALCULATOR.compute({ currency: 'USD', evidence: [] }).metrics.find((metric) => metric.key === 'medical_staff')).toMatchObject({ value: null, needs: ['HOSPITALS_MEDICAL_STAFF'] });
  });
});
