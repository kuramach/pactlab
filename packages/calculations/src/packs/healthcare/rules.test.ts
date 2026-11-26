import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { HEALTHCARE_CREDENTIALS_EXPIRING, HEALTHCARE_DENIALS_RISING, HEALTHCARE_DIRECTOR_FEE } from './rules';

describe('healthcare rules (T-061)', () => {
  it('prices the medical-director fee above documented duties', () => {
    const pages = [
      { documentId: 'd', pageNumber: 1, text: 'Duties: four hours per month of protocol review.\nFee: USD 9,500 per month, fixed.' },
      { documentId: 'd', pageNumber: 2, text: 'Time records for the last twelve months show an average of 1.5 hours per month of documented activity.' },
    ];
    const [found] = HEALTHCARE_DIRECTOR_FEE.detect({ evidence: [], pages });
    // (1 − 1.5/4) × 9,500 × 12 = 71,250 a year; three years at the high end.
    expect(found?.pricedRisk).toMatchObject({ type: 'INDEMNITY', currency: 'USD', low: '71250.00', high: '213750.00' });
    expect(found?.quotes).toHaveLength(3);
  });

  it('lists providers whose credentials lapse before year end, by pseudonymous reference', () => {
    const evidence: PackRuleEvidence[] = [
      { id: 'i', evidenceType: 'billing.invoice_line', sourceRecordId: 'i', canonical: { period_start: '2026-09-01' } },
      { id: 'p1', evidenceType: 'healthcare.provider', sourceRecordId: 'PR-04', canonical: { provider_ref: 'PR-04', fte: '1.0', credential_expiry: '2026-12-15' } },
      { id: 'p2', evidenceType: 'healthcare.provider', sourceRecordId: 'PR-05', canonical: { provider_ref: 'PR-05', fte: '0.6', credential_expiry: '2027-05-01' } },
    ];
    const [found] = HEALTHCARE_CREDENTIALS_EXPIRING.detect({ evidence, pages: [] });
    expect(found).toMatchObject({ evidenceIds: ['p1'], description: expect.stringContaining('PR-04') });
    // Without billing, the claims summary dates the year.
    const claims: PackRuleEvidence = { id: 'c', evidenceType: 'healthcare.claims_month', sourceRecordId: '2026-09|Payer', canonical: { month: '2026-09' } };
    expect(HEALTHCARE_CREDENTIALS_EXPIRING.detect({ evidence: [claims, ...evidence.slice(1)], pages: [] })[0]?.evidenceIds).toEqual(['p1']);
  });
});

describe('denials rising (T-161, shared by the healthcare variants)', () => {
  const claims = (rates: readonly string[]) =>
    ['2026-01', '2026-04', '2026-07'].flatMap((month, index) => [
      { id: `${month}-a`, evidenceType: 'healthcare.claims_month', sourceRecordId: `${month}-a`, canonical: { month, payer: 'A', claims: '300', denial_rate_pct: rates[index] ?? '0' } },
      { id: `${month}-b`, evidenceType: 'healthcare.claims_month', sourceRecordId: `${month}-b`, canonical: { month, payer: 'B', claims: '100', denial_rate_pct: '4' } },
    ]);

  it('a claims-weighted denial rate rising every quarter by two points or more', () => {
    const [found] = HEALTHCARE_DENIALS_RISING.detect({ evidence: claims(['4', '6', '8']), pages: [] });
    expect(found).toMatchObject({ title: 'Claim denials rising', direction: -1, severity: 'MEDIUM' });
    expect(found?.description).toMatch(/^The claims-weighted denial rate rose in every quarter, from 4\.0% in 2026-Q1 to 7\.0% in 2026-Q3/);
  });

  it('flat or falling denials, or a quarter that dips, are no finding', () => {
    expect(HEALTHCARE_DENIALS_RISING.detect({ evidence: claims(['5', '5', '5']), pages: [] })).toEqual([]);
    expect(HEALTHCARE_DENIALS_RISING.detect({ evidence: claims(['4', '9', '8']), pages: [] })).toEqual([]);
    expect(HEALTHCARE_DENIALS_RISING.detect({ evidence: claims(['4', '4.5', '5']), pages: [] })).toEqual([]);
  });
});
