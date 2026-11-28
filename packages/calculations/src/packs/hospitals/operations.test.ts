import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { capexFalling, checkCostReportClaims, checkQualityClaims, contractRegister, privilegeClusters, staffCredentials, type CapexYear } from './operations';
import { D } from '../../metrics/decimal';

const page = (documentId: string, text: string, pageNumber = 1): PackRulePage => ({ documentId, pageNumber, text });
const row = (id: string, evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });

describe('hospitals operations (T-162)', () => {
  it('checks a deck claim against the cost report of the year it names, never against a cost report itself', () => {
    const evidence = [
      row('cr24', 'hospitals.cost_report_year', { fiscal_year: '2024', bed_days_available: '80300', patient_days: '64240', medicare_days: '25000' }),
      row('cr25', 'hospitals.cost_report_year', { fiscal_year: '2025', bed_days_available: '80300', patient_days: '54420', medicare_days: '22312' }),
    ];
    const pages = [
      page('deck', 'Management presentation. Average occupancy of 80% in fiscal year 2024. Medicare accounts for 41.0% of patient days.'),
      page('report', 'Cost report summary, fiscal year 2025. Occupancy was 50% in the period.'),
    ];
    const checks = checkCostReportClaims(evidence, pages);
    // 80% against FY2024's 64,240 ÷ 80,300 = 80.0%: verified; the Medicare share reads the latest year, 41.0%.
    expect(checks.map((check) => [check.claim.key, check.claim.year, check.status])).toEqual([
      ['OCCUPANCY', '2024', 'VERIFIED'],
      ['MEDICARE_SHARE', null, 'VERIFIED'],
    ]);
    expect(checkCostReportClaims([], pages).every((check) => check.status === 'UNVERIFIED')).toBe(true);
  });

  it('measures a material payer’s agreement from the stated closing, the agreement’s own expiry governing', () => {
    const months = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`);
    const evidence = [
      ...months.flatMap((month) => [
        row(`a${month}`, 'hospitals.payer_month', { month, payer: 'Plan A (synthetic)', net_revenue: '800' }),
        row(`b${month}`, 'hospitals.payer_month', { month, payer: 'Plan B', net_revenue: '150' }),
        row(`s${month}`, 'hospitals.payer_month', { month, payer: 'Self-pay and other', net_revenue: '50' }),
      ]),
      row('pa', 'healthcare.payer_contract', { contract_id: 'PA-1', payer: 'Plan A (synthetic)', payer_class: 'commercial', expires_on: '2030-01-31', auto_renews: 'no', rate_basis: 'DRG case rates' }),
    ];
    const pages = [page('deck', 'The parties have agreed a target closing date of 31 December 2026.'), page('agreement', 'The agreement PA-1 expires on 31 July 2027.')];
    const register = contractRegister(evidence, pages);
    expect(register.from).toMatchObject({ date: '2026-12-31', basis: 'EXPECTED_CLOSING' });
    expect(register.payers.map((status) => [status.payer, status.state, status.monthsAfter, status.endBasis])).toEqual([
      ['Plan A (synthetic)', 'ENDS_IN_WINDOW', 7, 'DOCUMENT'],
      ['Plan B', 'MISSING', null, null],
    ]);
  });

  it('flags a department only when its physicians share one lapsed privilege date', () => {
    const cred = (ref: string, department: string, expires: string) => row(`${ref}`, 'healthcare.credential', { credential_ref: `CR-${ref}`, provider_ref: ref, kind: 'hospital_privileges', jurisdiction: 'X', issuer: 'Y', status: 'active', expires_on: expires, department });
    const evidence = [cred('PH-01', 'Orthopaedics', '2026-06-30'), cred('PH-02', 'Orthopaedics', '2026-06-30'), cred('PH-03', 'Orthopaedics', '2027-03-15'), cred('PH-04', 'Cardiology', '2026-06-30'), cred('PH-05', 'Cardiology', '2027-01-15'), cred('PH-06', 'Cardiology', '2027-02-15'), cred('PH-07', 'Cardiology', '2027-04-15')];
    const clusters = privilegeClusters(staffCredentials(evidence, [], '2026-09-30'));
    // Orthopaedics: two of three share the lapsed date; Cardiology: one lapse of four is not a cluster.
    expect(clusters.map((cluster) => [cluster.department, cluster.date, cluster.state, cluster.members.length])).toEqual([['Orthopaedics', '2026-06-30', 'LAPSED', 2]]);
    // A verification document that renews the date takes the department out.
    const renewed = [page('v', 'PH-01: orthopaedics clinical privileges — current, expires on 15 June 2028.')];
    expect(privilegeClusters(staffCredentials(evidence, renewed, '2026-09-30'))).toEqual([]);
  });

  it('reads a falling capex ratio only across three or more years, every year lower', () => {
    const years = (ratios: string[]): CapexYear[] => ratios.map((value, index) => ({ year: String(2021 + index), capex: new D(value), revenue: new D(1), ratio: new D(value), capexIds: [], revenueIds: [] }));
    expect(capexFalling(years(['0.072', '0.061', '0.050', '0.039', '0.028']))).toBe(true);
    expect(capexFalling(years(['0.072', '0.028']))).toBe(false);
    expect(capexFalling(years(['0.072', '0.061', '0.065', '0.039']))).toBe(false);
    expect(capexFalling(years(['0.072', '0.068', '0.066']))).toBe(false);
  });

  it('maps a quality claim to the reporting document that states the same measure', () => {
    const pages = [
      page('deck', 'Management presentation. The hospital holds an Overall Hospital Quality Star Rating of 4 stars. It also holds a Hospital Safety Grade of A from the reporting body.'),
      page('report', 'Quality ratings report, July 2026. Overall Hospital Quality Star Rating: 3 stars out of 5.'),
    ];
    expect(checkQualityClaims(pages).map((check) => [check.claim.measure, check.claim.value, check.reported?.value ?? null, check.status])).toEqual([
      ['STAR_RATING', '4', '3', 'CONTRADICTED'],
      ['SAFETY_GRADE', 'A', null, 'UNVERIFIED'],
    ]);
  });
});
