import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { CLINICS_CODING_ABOVE_POLICY, CLINICS_EQUIPMENT_PAST_LIFE, CLINICS_LEASE_TERM, CLINICS_OWNER_DEPENDENCE, CLINICS_PROVIDER_CARRIES_SITE, CLINICS_REFERRAL_CONCENTRATION, dateIn, wholeMonthsBetween } from './rules';

const row = (evidenceType: string, id: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });

describe('small clinics rules (T-068)', () => {
  it('a site where one pseudonymous provider earns half or more of revenue', () => {
    const evidence = ['2026-08', '2026-09'].flatMap((month) => [
      row('clinics.volume_month', `${month}-a`, { month, site: 'Site 3', provider_ref: 'P07', revenue: '750' }),
      row('clinics.volume_month', `${month}-b`, { month, site: 'Site 3', provider_ref: 'P08', revenue: '250' }),
      row('clinics.volume_month', `${month}-c`, { month, site: 'Site 1', provider_ref: 'P01', revenue: '400' }),
      row('clinics.volume_month', `${month}-d`, { month, site: 'Site 1', provider_ref: 'P02', revenue: '600' }),
    ]);
    const found = CLINICS_PROVIDER_CARRIES_SITE.detect({ evidence, pages: [] });
    expect(found.map((entry) => entry.title)).toEqual(['One provider carries Site 1', 'One provider carries Site 3']);
    expect(found[1]?.description).toMatch(/^P07 earns 75\.0% of Site 3 revenue over the 2 months to September 2026/);
  });

  it('coding above policy needs every quarter well above the benchmark and the policy text', () => {
    const quarters = ['2026-Q1', '2026-Q2'].map((quarter, index) => row('clinics.coding_quarter', quarter, { quarter, high_complexity_share: index ? '0.36' : '0.31', policy_benchmark: '0.15' }));
    const policy = [{ documentId: 'p', pageNumber: 1, text: 'Highest-complexity codes are expected for about 15% of visits.' }];
    expect(CLINICS_CODING_ABOVE_POLICY.detect({ evidence: quarters, pages: policy })[0]?.description).toMatch(/^From 2026-Q1 to 2026-Q2, 31\.0%–36\.0% of visits/);
    expect(CLINICS_CODING_ABOVE_POLICY.detect({ evidence: quarters, pages: [] })).toEqual([]);
    expect(CLINICS_CODING_ABOVE_POLICY.detect({ evidence: [...quarters, row('clinics.coding_quarter', 'q3', { quarter: '2026-Q3', high_complexity_share: '0.16', policy_benchmark: '0.15' })], pages: policy })).toEqual([]);
  });

  it('equipment past its useful life at the latest month, dated by billing or patient volume', () => {
    const volume = row('clinics.volume_month', 'v', { month: '2026-09', site: 'Site 1', provider_ref: 'P01', revenue: '1' });
    const evidence = [
      volume,
      row('clinics.equipment', 'x', { asset: 'Panoramic X-ray unit', site: 'Site 1', acquired: '2014-05-01', useful_life_years: '10', status: 'in service' }),
      row('clinics.equipment', 'c', { asset: 'Dental chairs (6)', site: 'Site 2', acquired: '2021-09-01', useful_life_years: '12', status: 'in service' }),
    ];
    const [found] = CLINICS_EQUIPMENT_PAST_LIFE.detect({ evidence, pages: [] });
    expect(found).toMatchObject({ title: 'Imaging equipment past its useful life', evidenceIds: ['x'] });
    expect(found?.description).toMatch(/^1 item is in service past its useful life at 2026-09-30: Panoramic X-ray unit at Site 1 \(acquired 2014-05-01, 10-year life, ended 2024-05-01\)/);
    expect(CLINICS_EQUIPMENT_PAST_LIFE.detect({ evidence: evidence.slice(1), pages: [] })).toEqual([]);
  });
});

describe('small clinics, the few-site variant (T-161)', () => {
  const visit = (id: string, month: string, line: string, provider: string, role: string, source: string, visits: string, collections: string) =>
    row('clinics.visit_month', id, { month, service_line: line, provider_ref: provider, provider_role: role, referral_source: source, visits, collections });
  const months = ['2026-07', '2026-08', '2026-09'];
  const visits = months.flatMap((month) => [
    visit(`${month}-i`, month, 'Implants', 'P01', 'owner', 'Northside Dental Group', '20', '30000'),
    visit(`${month}-h1`, month, 'Hygiene', 'P02', 'associate', 'Northside Dental Group', '40', '8000'),
    visit(`${month}-h2`, month, 'Hygiene', 'P01', 'owner', 'Self-referred', '10', '2000'),
    visit(`${month}-g`, month, 'General', 'P03', 'associate', 'Self-referred', '30', '9000'),
  ]);
  const margins = [
    row('clinics.service_line_year', 'sl-i', { year: '2026', service_line: 'Implants', revenue: '360000', direct_costs: '140000' }),
    row('clinics.service_line_year', 'sl-h', { year: '2026', service_line: 'Hygiene', revenue: '120000', direct_costs: '80000' }),
    row('clinics.service_line_year', 'sl-old', { year: '2025', service_line: 'Hygiene', revenue: '1', direct_costs: '0' }),
  ];

  it('the selling owner as the only provider of the highest-margin service line, with no succession plan filed', () => {
    const [found] = CLINICS_OWNER_DEPENDENCE.detect({ evidence: [...visits, ...margins], pages: [] });
    expect(found).toMatchObject({ title: 'Selling owner is the only provider of Implants', domain: 'PEOPLE', direction: -1, severity: 'HIGH' });
    expect(found?.pricedRisk ?? null).toBeNull();
    expect(found?.description).toMatch(/^Over the 3 months to September 2026, the selling owner \(P01, pseudonymous\) delivered 30\.0% of visits and 65\.3% of collections\. No associate or contractor delivered any Implants visit/);
    expect(found?.description).toContain('Implants is the highest-margin service line in 2026 (61.1% margin).');
    expect(found?.description).toContain('No succession or transition plan is among the documents filed.');
    expect(found?.evidenceIds).toEqual(['2026-07-i', '2026-08-i', '2026-09-i', 'sl-i', 'sl-h']);
    const plan = [{ documentId: 'd', pageNumber: 2, text: 'A succession plan names the associate who takes over implants within six months.' }];
    expect(CLINICS_OWNER_DEPENDENCE.detect({ evidence: visits, pages: plan })[0]).toMatchObject({ quotes: [{ documentId: 'd', pageNumber: 2 }] });
    expect(CLINICS_OWNER_DEPENDENCE.detect({ evidence: visits, pages: [] })[0]?.description).toContain('Service-line margins are not imported');
  });

  it('an owner with associate cover everywhere and a small share is no finding', () => {
    const covered = visits.map((entry) => (entry.canonical['service_line'] === 'Implants' ? { ...entry, canonical: { ...entry.canonical, provider_ref: 'P04', provider_role: 'associate' } } : entry));
    expect(CLINICS_OWNER_DEPENDENCE.detect({ evidence: covered, pages: [] })).toEqual([]);
  });

  it('one outside referral source sending 40% or more of visits; self-referral never counts as the source', () => {
    const [found] = CLINICS_REFERRAL_CONCENTRATION.detect({ evidence: visits, pages: [] });
    expect(found).toMatchObject({ title: 'One referral source sends 60.0% of visits', direction: 0, severity: 'HIGH' });
    expect(found?.description).toMatch(/^Northside Dental Group referred 180 of 300 visits \(60\.0%\) over the 3 months to September 2026/);
    const selfLed = visits.map((entry) => ({ ...entry, canonical: { ...entry.canonical, referral_source: entry.canonical['referral_source'] === 'Northside Dental Group' ? 'Walk-in' : 'Self-referred' } }));
    expect(CLINICS_REFERRAL_CONCENTRATION.detect({ evidence: selfLed, pages: [] })).toEqual([]);
  });

  it('reads dates as documents write them', () => {
    expect(dateIn('The term expires on 2028-03-31.')).toBe('2028-03-31');
    expect(dateIn('ends on 31 March 2028')).toBe('2028-03-31');
    expect(dateIn('ends on March 31, 2028')).toBe('2028-03-31');
    expect(dateIn('no date here')).toBeNull();
    expect(wholeMonthsBetween('2027-01-31', '2028-03-31')).toBe(14);
    expect(wholeMonthsBetween('2027-01-31', '2028-03-30')).toBe(13);
  });

  it('a lease ending 14 months after the target close with no renewal option, priced from the relocation estimate', () => {
    const pages = [
      { documentId: 'lease', pageNumber: 1, text: 'The term of this lease expires on 31 March 2028.\nTenant has no option to renew or extend the term.\nThe tenant may not assign this lease without the landlord’s prior written consent.' },
      { documentId: 'loi', pageNumber: 1, text: 'The target closing date is 31 January 2027.' },
      { documentId: 'memo', pageNumber: 1, text: 'Estimated cost to relocate and fit out a replacement site: USD 420,000.' },
    ];
    const [found] = CLINICS_LEASE_TERM.detect({ evidence: [], pages });
    expect(found).toMatchObject({ title: 'Clinic lease ends 14 months after closing with no renewal option', domain: 'PROPERTY', direction: -1, severity: 'HIGH', pricedRisk: { type: 'REMEDIATION_COST', currency: 'USD', low: '210000.00', high: '420000.00' } });
    expect(found?.quotes).toHaveLength(5);
    expect(found?.description).toContain('On renewal: “Tenant has no option to renew or extend the term.”');
    // A renewal option, or a long remaining term, is no finding.
    const renewable = [{ ...pages[0]!, text: 'The term of this lease expires on 31 March 2028. Tenant has an option to renew for five years.' }, ...pages.slice(1)];
    expect(CLINICS_LEASE_TERM.detect({ evidence: [], pages: renewable })).toEqual([]);
    expect(CLINICS_LEASE_TERM.detect({ evidence: [], pages: [{ ...pages[0]!, text: 'The term of this lease expires on 31 March 2031.' }, pages[1]!] })).toEqual([]);
    // Without a stated closing date, the term is measured from the latest billed month and the finding says so, unpriced.
    const billed = row('billing.invoice_line', 'b', { period_start: '2026-09-01', amount: '1' });
    const [fallback] = CLINICS_LEASE_TERM.detect({ evidence: [billed], pages: [pages[0]!] });
    expect(fallback).toMatchObject({ title: 'Clinic lease ends 18 months after the latest billed month with no renewal option', pricedRisk: null });
    expect(fallback?.description).toContain('no target closing date is stated');
  });
});
