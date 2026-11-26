import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { ageingByYear, ageingReports, billingRows, billingYears, ceilingClaims, coverageFor, practiceModel } from './practice';
import { SERVICES_AGEING_DRIFT, SERVICES_CONCENTRATION_CLAIMS, SERVICES_RAINMAKER_COVERAGE, SERVICES_REALIZATION_TREND, SERVICES_REVENUE_QUALITY } from './rules';

const row = (evidenceType: string, id: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const months = (from: number, to: number, year: number) => Array.from({ length: to - from + 1 }, (_, index) => `${year}-${String(from + index).padStart(2, '0')}`);
const page = (text: string, pageNumber = 1, documentId = 'doc'): PackRulePage => ({ documentId, pageNumber, text });

/** One client billed by its partner each month; realization per year. */
function billing(spec: { client: string; partner: string; engagement: string; fees: string }[], realization: Record<string, string>, monthList: readonly string[]) {
  return monthList.flatMap((month) =>
    spec.map((entry, index) => {
      const rate = realization[month.slice(0, 4)] ?? '1';
      return row('services.billing_month', `${month}:${index}`, {
        month,
        client: entry.client,
        engagement: entry.engagement,
        fee_earner: entry.partner,
        relationship_partner: entry.partner,
        hours_worked: '10',
        standard_value: (Number(entry.fees) / Number(rate)).toFixed(2),
        billed: entry.fees,
        collected: entry.fees,
      });
    }),
  );
}

const BOOK = [
  { client: 'Alpha Retail (synthetic)', partner: 'P-01', engagement: 'retainer', fees: '300' },
  { client: 'Beta Mutual (synthetic)', partner: 'P-02', engagement: 'project', fees: '500' },
  { client: 'Gamma Transit (synthetic)', partner: 'P-03', engagement: 'project', fees: '200' },
];

describe('professional services practice model (T-167)', () => {
  it('fees by client and by partner over the trailing twelve months, and the recurring share', () => {
    const model = practiceModel(billingRows(billing(BOOK, {}, months(1, 12, 2026))));
    expect(model.trailing).toMatchObject({ from: '2026-01', to: '2026-12', missing: [] });
    expect(model.clients.map((entry) => [entry.key, entry.share?.toFixed(2)])).toEqual([['Beta Mutual (synthetic)', '0.50'], ['Alpha Retail (synthetic)', '0.30'], ['Gamma Transit (synthetic)', '0.20']]);
    expect(model.partners[0]?.key).toBe('P-02');
    expect(model.recurringShare?.toFixed(2)).toBe('0.30');
  });

  it('reads the deck’s ceilings and checks them against the export', () => {
    const evidence = billing(BOOK, {}, months(1, 12, 2026));
    const pages = [page('No client exceeds 15% of fees. No partner relationship accounts for more than 60% of fees. Revenue grew 12% last year.')];
    expect(ceilingClaims(pages).map((claim) => [claim.key, claim.ceiling.toString()])).toEqual([['CLIENT_CEILING', '0.15'], ['PARTNER_CEILING', '0.6']]);
    const found = SERVICES_CONCENTRATION_CLAIMS.detect({ evidence, pages });
    expect(found.map((proposal) => [proposal.title, proposal.direction, proposal.claim?.status])).toEqual([
      ['Claim contradicted: Client concentration ceiling', -1, 'CONTRADICTED'],
      ['Claim verified: Partner concentration ceiling', 1, 'VERIFIED'],
    ]);
    expect(found[0]?.description).toContain('Beta Mutual (synthetic), the largest client, carried 50.0% of the fees billed for January 2026 to December 2026');
    // Without twelve complete months the claim is a gap, never a guess.
    expect(SERVICES_CONCENTRATION_CLAIMS.detect({ evidence: billing(BOOK, {}, months(1, 6, 2026)), pages }).map((proposal) => proposal.claim?.status)).toEqual(['UNVERIFIED', 'UNVERIFIED']);
  });

  it('realization by complete calendar year; falling every year is a finding, a partial year is left out', () => {
    const evidence = billing(BOOK, { '2023': '0.92', '2024': '0.87', '2025': '0.81' }, [...months(1, 12, 2023), ...months(1, 12, 2024), ...months(1, 12, 2025), ...months(1, 3, 2026)]);
    expect(billingYears(billingRows(evidence)).map((year) => [year.year, year.realization?.toFixed(2)])).toEqual([['2023', '0.92'], ['2024', '0.87'], ['2025', '0.81']]);
    const [found] = SERVICES_REALIZATION_TREND.detect({ evidence, pages: [] });
    expect(found).toMatchObject({ title: 'Realization falling every year, 2023–2025', direction: -1, pricedRisk: null });
    expect(found?.description).toMatch(/^Fees billed as a share of the standard value of the time worked fell every year: 2023 92\.0% \(collected 100\.0% of fees\), 2024 87\.0%/);
    // One year reads as one year: no trend.
    expect(SERVICES_REALIZATION_TREND.detect({ evidence: billing(BOOK, { '2025': '0.81' }, months(1, 12, 2025)), pages: [] })).toEqual([]);
  });

  it('WIP over 90 days by year end; doubling is priced into working capital', () => {
    const band = (asOf: string, ledger: string, name: string, amount: string) => row('services.ageing_band', `${asOf}:${ledger}:${name}`, { as_of: asOf, ledger, band: name, amount });
    const evidence = [
      band('2024-06-30', 'wip', '91-180', '999'),
      band('2024-12-31', 'wip', '0-30', '900'),
      band('2024-12-31', 'wip', '91-180', '100'),
      band('2025-12-31', 'wip', '0-30', '900'),
      band('2025-12-31', 'wip', '91-180', '150'),
      band('2025-12-31', 'wip', '181+', '60'),
      band('2024-12-31', 'ar', '181+', '100'),
      band('2025-12-31', 'ar', '181+', '120'),
      row('billing.invoice_line', 'b', { currency: 'USD', amount: '1', customer_name: 'Alpha', period_start: '2025-12-01' }),
    ];
    const years = ageingByYear(ageingReports(evidence));
    expect(years['wip']?.map((year) => [year.asOf, year.over90.toString()])).toEqual([['2024-12-31', '100'], ['2025-12-31', '210']]);
    const found = SERVICES_AGEING_DRIFT.detect({ evidence, pages: [] });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: 'WIP over 90 days up 2.1× in a year, 2024–2025', direction: -1, pricedRisk: { type: 'PRICE_REDUCTION', currency: 'USD', low: '55.00', high: '110.00' } });
  });

  it('covenant cover is read from covenant documents only, and a stated "none" is not cover', () => {
    const register = page('Restrictive covenant register (synthetic).\nP-03: non-solicitation of clients for 12 months.\nP-01 and P-02: no non-compete or non-solicitation covenant.', 1, 'register');
    const deck = page('Management presentation. P-04 signed a non-compete in 2024.', 1, 'deck');
    expect(coverageFor([register, deck], 'P-03').state).toBe('COVERED');
    expect(coverageFor([register, deck], 'P-01')).toMatchObject({ state: 'STATED_NONE', quote: { quote: 'P-01 and P-02: no non-compete or non-solicitation covenant.' } });
    // The deck is not a covenant document; P-04 is not in the evidence.
    expect(coverageFor([register, deck], 'P-04').state).toBe('NOT_IN_EVIDENCE');
    // A whole-token reference: P-01 is not P-010.
    expect(coverageFor([page('Restrictive covenant register.\nP-010: non-compete for 6 months.', 1, 'r2')], 'P-01').state).toBe('NOT_IN_EVIDENCE');

    const evidence = billing(BOOK, {}, months(1, 12, 2026));
    // Waits for documents.
    expect(SERVICES_RAINMAKER_COVERAGE.detect({ evidence, pages: [] })).toEqual([]);
    const found = SERVICES_RAINMAKER_COVERAGE.detect({ evidence, pages: [register] });
    expect(found.map((proposal) => [proposal.title, proposal.domain, proposal.direction])).toEqual([
      ['Rainmaker with no non-solicit or non-compete on file: P-02', 'PEOPLE', -1],
      ['Rainmaker with no non-solicit or non-compete on file: P-01', 'PEOPLE', -1],
    ]);
    expect(found[0]?.description).toContain('not an assessment of the person');
  });

  it('revenue quality is a record of the split, neutral', () => {
    const [found] = SERVICES_REVENUE_QUALITY.detect({ evidence: billing(BOOK, {}, months(1, 12, 2026)), pages: [] });
    expect(found).toMatchObject({ title: 'Revenue quality: 30.0% recurring, twelve months to December 2026', direction: 0, severity: 'INFO' });
  });
});
