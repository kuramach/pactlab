import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { CLINICS_METRICS_CALCULATOR } from './metrics';
import { clinicLeases, expectedClosing, premisesStatuses, referralMonths, referralWindow, sellingOwner, serviceLineMonths, serviceLineWindow, successionEvidence, wholeMonths } from './practice';
import { CLINICS_OWNER_DEPENDENCE, CLINICS_PNL_EXPENSE_OUTPACING, CLINICS_PREMISES, CLINICS_REFERRAL_CONCENTRATION, CLINICS_RULES } from './rules';

const DOC = '01900000-0000-7000-8000-0000000f0101';
const LEASE = '01900000-0000-7000-8000-0000000f0102';
const page = (text: string, pageNumber = 1, documentId = DOC): PackRulePage => ({ documentId, pageNumber, text });
const row = (id: string, evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const LAST12 = Array.from({ length: 12 }, (_, index) => `${index < 3 ? 2025 : 2026}-${String(((index + 9) % 12) + 1).padStart(2, '0')}`);

/** Two service lines for twelve months: P01 alone does implants (high margin); P01 and P02 share hygiene. */
function serviceLines(): PackRuleEvidence[] {
  return LAST12.flatMap((month) => [
    row(`${month}:imp:P01`, 'clinics.service_line_month', { month, service_line: 'Implants', provider_ref: 'P01', visits: '20', collected: '8000.00', direct_cost: '2400.00' }),
    row(`${month}:hyg:P01`, 'clinics.service_line_month', { month, service_line: 'Hygiene', provider_ref: 'P01', visits: '40', collected: '4000.00', direct_cost: '2400.00' }),
    row(`${month}:hyg:P02`, 'clinics.service_line_month', { month, service_line: 'Hygiene', provider_ref: 'P02', visits: '60', collected: '6000.00', direct_cost: '3600.00' }),
  ]);
}

function referrals(top: number): PackRuleEvidence[] {
  return LAST12.flatMap((month) => [
    row(`${month}:a`, 'clinics.referral_month', { month, referral_source: 'Valley Hospital (synthetic)', source_type: 'hospital', visits: String(top) }),
    row(`${month}:b`, 'clinics.referral_month', { month, referral_source: 'Self-referral', source_type: 'self-referral', visits: String(100 - top) }),
  ]);
}

const OWNER = page('Brightwater Dental (synthetic) — memorandum. P01 is the selling owner and principal dentist. There is no succession plan in place.');
const leasePage = (renewal: string, assignment: string) =>
  page(`Lease of premises at 12 Harbour Street (synthetic). The term ends on 31 January 2028. ${renewal} ${assignment}`, 1, LEASE);

describe('small clinics practice model (T-161)', () => {
  it('recomputes service-line margins and providers, highest margin first', () => {
    const window = serviceLineWindow(serviceLineMonths(serviceLines()));
    expect(window?.lines.map((line) => [line.serviceLine, line.margin?.toFixed(2), line.providers.map((provider) => provider.providerRef)])).toEqual([
      ['Implants', '0.70', ['P01']],
      ['Hygiene', '0.40', ['P02', 'P01']],
    ]);
    expect(window?.collected.toFixed(2)).toBe('216000.00');
  });

  it('reads the selling owner and the absence of a succession plan from one memorandum', () => {
    expect(sellingOwner([OWNER])?.providerRef).toBe('P01');
    expect(successionEvidence([OWNER])).toMatchObject({ inPlace: false });
    expect(successionEvidence([page('P01 has agreed a twelve-month transition period after closing.')])).toMatchObject({ inPlace: true });
    expect(sellingOwner([page('Associates P02 and P03 work three days a week.')])).toBeNull();
  });

  it('reads the lease: the end date, renewal and assignment, and the months left after the expected closing', () => {
    const lease = leasePage('There is no option to renew or extend the term.', 'The tenant may not assign this lease without the landlord’s prior written consent.');
    const closing = page('The parties have agreed a target closing date of 30 November 2026.');
    expect(clinicLeases([lease])).toMatchObject([{ expiresOn: '2028-01-31', renewal: 'NONE', assignment: 'CONSENT' }]);
    expect(expectedClosing([closing])?.date).toBe('2026-11-30');
    expect(premisesStatuses([lease, closing], '2026-09-30')).toMatchObject([{ monthsRemaining: 14, short: true, from: { basis: 'EXPECTED_CLOSING' } }]);
    // No closing date stated: measured from the analysis date, and said so.
    expect(premisesStatuses([lease], '2026-09-30')).toMatchObject([{ monthsRemaining: 16, from: { basis: 'ANALYSIS_DATE' } }]);
    expect(clinicLeases([page('Equipment schedule (synthetic). Two chairs.')])).toEqual([]);
    // A second copy of the same lease (a data room duplicate) is read once.
    expect(clinicLeases([lease, { ...lease, documentId: DOC }])).toHaveLength(1);
    expect(wholeMonths('2026-11-30', '2028-01-31')).toBe(14);
    expect(wholeMonths('2026-11-15', '2027-11-14')).toBe(11);
  });

  it('recomputes visits by referral source', () => {
    const window = referralWindow(referralMonths(referrals(58)));
    expect(window?.sources[0]).toMatchObject({ source: 'Valley Hospital (synthetic)' });
    expect(window?.sources[0]?.share?.toFixed(2)).toBe('0.58');
  });
});

describe('small clinics rules (T-161)', () => {
  it('drafts the owner as the only provider of the highest-margin line, and the owner share with no succession', () => {
    const found = CLINICS_OWNER_DEPENDENCE.detect({ evidence: serviceLines(), pages: [OWNER] });
    expect(found.map((proposal) => [proposal.title, proposal.direction, proposal.severity])).toEqual([
      ['The selling owner is the only provider of the highest-margin service line: Implants', -1, 'HIGH'],
      ['The selling owner delivers 66.7% of collections, with no succession or associate coverage on file', -1, 'HIGH'],
    ]);
    expect(found[0]?.description).toContain('at a 70.0% margin after direct costs, the highest of 2 lines');
    expect(found[0]?.evidenceIds).toHaveLength(12);
    // Succession in place: only the sole-provider line is drafted. No owner named: nothing.
    expect(CLINICS_OWNER_DEPENDENCE.detect({ evidence: serviceLines(), pages: [page('P01 is the selling owner. P01 has agreed a twelve-month transition period after closing.')] })).toHaveLength(1);
    expect(CLINICS_OWNER_DEPENDENCE.detect({ evidence: serviceLines(), pages: [] })).toEqual([]);
  });

  it('drafts a single dominant referral source, and nothing under 40%', () => {
    expect(CLINICS_REFERRAL_CONCENTRATION.detect({ evidence: referrals(58), pages: [] }).map((proposal) => [proposal.title, proposal.direction, proposal.severity])).toEqual([
      ['58.0% of visits come from one referral source: Valley Hospital (synthetic)', -1, 'HIGH'],
    ]);
    expect(CLINICS_REFERRAL_CONCENTRATION.detect({ evidence: referrals(35), pages: [] })).toEqual([]);
  });

  it('drafts a short lease with no renewal (−1) and consent to assign (0); a renewal option drafts no term finding', () => {
    const closing = page('The parties have agreed a target closing date of 30 November 2026.');
    const short = CLINICS_PREMISES.detect({ evidence: serviceLines(), pages: [leasePage('There is no option to renew or extend the term.', 'The tenant may not assign this lease without the landlord’s prior written consent.'), closing] });
    expect(short.map((proposal) => [proposal.title, proposal.direction])).toEqual([
      ['Clinic lease ends 14 months after closing, with no renewal option', -1],
      ['Clinic lease: assignment on a sale needs the landlord’s consent', 0],
    ]);
    expect(short[0]?.quotes?.map((quote) => quote.quote)).toContain('The term ends on 31 January 2028.');
    const renews = CLINICS_PREMISES.detect({ evidence: serviceLines(), pages: [leasePage('The tenant has an option to renew for a further term of five years.', 'The tenant may assign this lease on a sale of the practice.'), closing] });
    expect(renews).toEqual([]);
  });

  it('reads supplies outpacing revenue across the imported years', () => {
    const pnl = (account: string, kind: string, amounts: string[]) =>
      ['2023', '2024', '2025'].map((period, index) => row(`${account}:${period}`, 'finance.pnl_line', { account, line_kind: kind, month: period, amount: amounts[index] ?? '0' }));
    const evidence = [...pnl('Patient revenue', 'REVENUE', ['1000000', '1050000', '1100000']), ...pnl('Clinical and dental supplies', 'COGS', ['60000', '78000', '99000'])];
    const found = CLINICS_PNL_EXPENSE_OUTPACING.detect({ evidence, pages: [] });
    expect(found.map((proposal) => proposal.direction)).toEqual([-1]);
    expect(found[0]?.title).toMatch(/supplies/i);
  });

  it('every rule is versioned and named for the pack, and the calculator adds the clinic figures to the healthcare ones', () => {
    expect(CLINICS_RULES.every((rule) => rule.id.startsWith('clinics-') && rule.version === '1')).toBe(true);
    const report = CLINICS_METRICS_CALCULATOR.compute({ currency: 'USD', evidence: [...serviceLines(), ...referrals(58)] });
    expect(report).toMatchObject({ calculator: 'clinics-practice', version: 'clinics-practice-1' });
    const byKey = Object.fromEntries(report.metrics.map((metric) => [metric.key, metric]));
    expect(byKey['collected']).toMatchObject({ value: null, needs: ['HEALTHCARE_REMITTANCES'] });
    expect(byKey['best_service_line_margin']).toMatchObject({ value: '0.7000', label: 'Highest service-line margin (Implants)' });
    expect(byKey['top_referral_share']).toMatchObject({ value: '0.5800' });
    expect(byKey['largest_service_line_share']).toMatchObject({ value: '0.5556' });
  });
});
