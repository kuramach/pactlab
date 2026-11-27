import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { HEALTHCARE_METRICS_CALCULATOR } from './metrics';
import { collectionYears, covenantFor, healthcareComplianceDocuments, practiceClaims, refPattern, remittanceMonths, trailingCollections, verifiedExpiry } from './practice';
import {
  HEALTHCARE_CLINICIAN_CONCENTRATION,
  HEALTHCARE_COLLECTIONS_RECONCILIATION,
  HEALTHCARE_COLLECTIONS_TREND,
  HEALTHCARE_COMPLIANCE_EVIDENCE,
  HEALTHCARE_CREDENTIALING,
  HEALTHCARE_PAYER_CONTRACTS,
  HEALTHCARE_PAYER_MIX_SHIFT,
  HEALTHCARE_PNL_EXPENSE_OUTPACING,
  HEALTHCARE_PRACTICE_CLAIMS,
  HEALTHCARE_RULES,
} from './rules';

const DOC = '01900000-0000-7000-8000-0000000f0002';
const page = (text: string, pageNumber = 1, documentId = DOC): PackRulePage => ({ documentId, pageNumber, text });
const row = (id: string, evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const months = (from: number, to: number) => Array.from({ length: (to - from) * 12 + 12 }, (_, index) => `${from + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`);

/**
 * Two payers, January 2023 to September 2026. Commercial pays 140 a claim and Medicaid 60; Medicaid's
 * claims double from 2023 to 2025 while commercial's hold, and denials rise every year.
 */
function remittances(): PackRuleEvidence[] {
  const plan: Record<string, { medicaidClaims: number; denied: number }> = { '2023': { medicaidClaims: 20, denied: 4 }, '2024': { medicaidClaims: 30, denied: 6 }, '2025': { medicaidClaims: 40, denied: 9 }, '2026': { medicaidClaims: 40, denied: 9 } };
  return months(2023, 2026)
    .filter((month) => month <= '2026-09')
    .flatMap((month) => {
      const year = plan[month.slice(0, 4)] ?? { medicaidClaims: 0, denied: 0 };
      return [
        { payer: 'Plan North', payerClass: 'commercial', claims: 50, collected: 7000, denied: 2 },
        { payer: 'Programme B', payerClass: 'medicaid', claims: year.medicaidClaims, collected: year.medicaidClaims * 60, denied: year.denied - 2 },
      ].map((entry) =>
        row(`${month}:${entry.payer}`, 'healthcare.remittance_month', {
          month,
          payer: entry.payer,
          payer_class: entry.payerClass,
          claims: String(entry.claims),
          denied_claims: String(entry.denied),
          billed: (entry.collected * 1.4).toFixed(2),
          collected: entry.collected.toFixed(2),
          ar_balance: (entry.collected * 1.4 * 1.4).toFixed(2),
        }),
      );
    });
}

/** Collections by clinician, October 2025 to September 2026: PR-01 40%, PR-02 50%, PR-03 10%. */
function collections(): PackRuleEvidence[] {
  return months(2025, 2026)
    .filter((month) => month >= '2025-10' && month <= '2026-09')
    .flatMap((month) =>
      [['PR-01', 4000], ['PR-02', 5000], ['PR-03', 1000]].map(([ref, amount]) => row(`${month}:${ref}`, 'healthcare.clinician_month', { month, provider_ref: String(ref), visits: '40', collected: `${amount}.00` })),
    );
}

const roster = ['PR-01', 'PR-02', 'PR-03', 'PR-04'].map((ref) => row(`roster:${ref}`, 'healthcare.provider', { provider_ref: ref, specialty: 'Primary care', fte: '1.0', credential_expiry: '2027-06-01' }));
const credentials = [
  row('cr1', 'healthcare.credential', { credential_ref: 'CR-0101', provider_ref: 'PR-01', kind: 'state_licence', jurisdiction: 'Ohio', issuer: 'Board', status: 'active', expires_on: '2027-03-31' }),
  row('cr2', 'healthcare.credential', { credential_ref: 'CR-0201', provider_ref: 'PR-02', kind: 'state_licence', jurisdiction: 'Ohio', issuer: 'Board', status: 'active', expires_on: '2026-11-15' }),
  row('cr4', 'healthcare.credential', { credential_ref: 'CR-0401', provider_ref: 'PR-04', kind: 'state_licence', jurisdiction: 'Ohio', issuer: 'Board', status: 'expired', expires_on: '2026-01-31' }),
];
const verification = page('Licence verification report (synthetic).\nVerified on 28 September 2026.\nPR-01: medical licence, Ohio — expired on 31 March 2026; no renewal on the register.\nPR-10: medical licence, Ohio — expired on 1 January 2020.', 1, 'verification');
const covenants = page('Schedule 4.12: restrictive covenants (synthetic).\nPR-02: non-compete, 24 months within 15 miles.', 1, 'covenants');

describe('healthcare practice model (T-160)', () => {
  it('reads remittances by calendar year, leaving a partial year out, never scaled up', () => {
    const rows = remittanceMonths(remittances());
    const { years, partialYears } = collectionYears(rows);
    expect(years.map((year) => year.label)).toEqual(['2023', '2024', '2025']);
    expect(partialYears).toEqual(['2026']);
    // 2025: 9 denied of 90 a month; commercial 7,000 of 9,400 collected.
    expect(years[2]?.denialRate?.toFixed(4)).toBe('0.1000');
    expect(years[2]?.byClass.find((entry) => entry.payerClass === 'medicaid')?.yieldPerClaim?.toFixed(0)).toBe('60');
    // Receivables at December ÷ (a year of charges ÷ 365): 1.4 months of charges ≈ 42.6 days.
    expect(years[2]?.daysInAr?.toFixed(1)).toBe('42.6');
    expect(trailingCollections(rows)).toMatchObject({ from: '2025-10', to: '2026-09', missing: [] });
  });

  it('reads the deck’s denial, payer-share and days-in-AR claims', () => {
    const claims = practiceClaims([page('Claim denial rate fell from 8.4% in FY2023 to 6.1% in FY2025. Commercial payers were 41% of collections in FY2025. Days in accounts receivable at 31 December 2025: 43 days.')]);
    expect(claims.map((claim) => [claim.key, claim.value.toString(), claim.year, claim.movement])).toEqual([
      ['DENIAL_RATE', '6.1', '2025', 'DOWN'],
      ['PAYER_SHARE', '41', '2025', null],
      ['DAYS_IN_AR', '43', '2025', null],
    ]);
    expect(claims[0]?.from).toMatchObject({ year: '2023' });
  });

  it('matches a pseudonymous reference as a whole token only', () => {
    expect(refPattern('PR-1').test('PR-10: medical licence')).toBe(false);
    expect(refPattern('PR-10').test('PR-10: medical licence')).toBe(true);
    expect(verifiedExpiry([verification], 'PR-01', 'state_licence')?.date).toBe('2026-03-31');
    expect(verifiedExpiry([verification], 'PR-01', 'controlled_substance')).toBeNull();
    expect(covenantFor([covenants], 'PR-02')?.quote).toMatch(/^PR-02: non-compete/);
    expect(covenantFor([covenants], 'PR-01')).toBeNull();
  });

  it('recognises compliance evidence by its heading and date', () => {
    const found = healthcareComplianceDocuments([verification, covenants, page('Coding and billing audit (synthetic). Audit date: 12 June 2024.', 1, 'audit')]);
    expect(found.map((document) => [document.kind, document.date])).toEqual([
      ['CODING_AUDIT', '2024-06-12'],
      ['RESTRICTIVE_COVENANTS', null],
      ['LICENCE_VERIFICATION', '2026-09-28'],
    ]);
  });
});

describe('healthcare rules (T-160)', () => {
  const evidence = [...remittances(), ...collections(), ...roster, ...credentials];
  const pages = [verification, covenants, page('Coding and billing audit (synthetic). Audit date: 12 June 2024.', 1, 'audit')];

  it('settles the deck’s claims against the remittances: contradicted, verified and unverified', () => {
    const deck = page('Claim denial rate fell from 8.4% in FY2023 to 6.1% in FY2025. Commercial payers were 74.5% of collections in FY2025. Days in accounts receivable at 31 December 2025: 50 days.', 1, 'deck');
    const found = HEALTHCARE_PRACTICE_CLAIMS.detect({ evidence, pages: [deck] });
    expect(found.map((proposal) => [proposal.key, proposal.direction, proposal.claim?.status])).toEqual([
      ['DENIAL_RATE:contradicted', -1, 'CONTRADICTED'],
      ['PAYER_SHARE:verified', 1, 'VERIFIED'],
      ['DAYS_IN_AR:contradicted', -1, 'CONTRADICTED'],
    ]);
    expect(found[0]?.description).toMatch(/rose, not fell, from 2023 to 2025/);
    // Nothing to check against: unverified, a gap.
    expect(HEALTHCARE_PRACTICE_CLAIMS.detect({ evidence: [], pages: [deck] }).map((proposal) => proposal.claim?.status)).toEqual(['UNVERIFIED', 'UNVERIFIED', 'UNVERIFIED']);
  });

  it('drafts the rising denial rate and the shift toward the lowest-paying payer, with the mix cost', () => {
    expect(HEALTHCARE_COLLECTIONS_TREND.detect({ evidence, pages: [] }).map((proposal) => [proposal.key, proposal.direction])).toEqual([['2023–2025:denials', -1]]);
    const [mix] = HEALTHCARE_PAYER_MIX_SHIFT.detect({ evidence, pages: [] });
    expect(mix).toMatchObject({ key: '2023–2025:medicaid', direction: -1, title: 'Payer mix shifted toward Medicaid, the lowest-paying payer class, 2023–2025' });
    // 2025's 90 claims a month at 2023's mix (50/70 commercial) and 2025's yields: 1,080 × (5/7 × 140 + 2/7 × 60) = 126,514, against 112,800 collected.
    expect(mix?.description).toContain('would have been 13,714 higher');
    // One year reads as one year: nothing until there are two.
    const oneYear = remittances().filter((entry) => (entry.canonical['month'] ?? '').startsWith('2025'));
    expect(HEALTHCARE_COLLECTIONS_TREND.detect({ evidence: oneYear, pages: [] })).toEqual([]);
    expect(HEALTHCARE_PAYER_MIX_SHIFT.detect({ evidence: oneYear, pages: [] })).toEqual([]);
  });

  it('checks every rostered clinician’s licence; the verification document governs the date', () => {
    expect(HEALTHCARE_CREDENTIALING.detect({ evidence, pages: [] })).toEqual([]);
    const found = HEALTHCARE_CREDENTIALING.detect({ evidence, pages });
    expect(found.map((proposal) => [proposal.key, proposal.direction, proposal.severity])).toEqual([
      ['PR-01:CR-0101:practising', -1, 'HIGH'],
      ['PR-02:CR-0201:2026-11-15:near-expiry', 0, 'MEDIUM'],
      ['PR-04:CR-0401:lapsed', 0, 'MEDIUM'],
      ['PR-03:no-licence', 0, 'MEDIUM'],
    ]);
    // Collections in the months that begin after 31 March 2026 (April to September): 6 × 4,000.
    expect(found[0]?.description).toContain('24,000 collected');
    expect(found[0]?.description).toContain('The register gives 2027-03-31 (status active); the verification document governs.');
    expect(found[0]?.quotes?.[0]?.quote).toMatch(/^PR-01: medical licence/);
  });

  it('flags a clinician carrying a fifth of collections only when no document names a non-compete or retention agreement', () => {
    expect(HEALTHCARE_CLINICIAN_CONCENTRATION.detect({ evidence, pages: [] })).toEqual([]);
    const found = HEALTHCARE_CLINICIAN_CONCENTRATION.detect({ evidence, pages });
    expect(found.map((proposal) => [proposal.key, proposal.direction, proposal.domain])).toEqual([['PR-01:2026-09', -1, 'PEOPLE']]);
    expect(found[0]?.title).toBe('40.0% of collections from one clinician, no non-compete on file: PR-01');
  });

  it('reads the payer contract register at the analysis date', () => {
    const contracts = [
      row('k1', 'healthcare.payer_contract', { contract_id: 'PA-N', payer: 'Plan North', payer_class: 'commercial', expires_on: '2027-03-31', auto_renews: 'no' }),
    ];
    const found = HEALTHCARE_PAYER_CONTRACTS.detect({ evidence: [...evidence, ...contracts], pages: [] });
    expect(found.map((proposal) => [proposal.key, proposal.direction])).toEqual([
      ['PA-N:2027-03-31:expiring', 0],
      ['Programme B:no-contract', 0],
    ]);
    const expired = [row('k1', 'healthcare.payer_contract', { contract_id: 'PA-N', payer: 'plan north', payer_class: 'commercial', expires_on: '2026-06-30', auto_renews: 'no' })];
    expect(HEALTHCARE_PAYER_CONTRACTS.detect({ evidence: [...evidence, ...expired], pages: [] })[0]).toMatchObject({ key: 'PA-N:expired', direction: -1 });
    // No register imported: nothing is assumed missing.
    expect(HEALTHCARE_PAYER_CONTRACTS.detect({ evidence, pages: [] })).toEqual([]);
  });

  it('drafts a stale coding audit, never the absence of one', () => {
    expect(HEALTHCARE_COMPLIANCE_EVIDENCE.detect({ evidence, pages }).map((proposal) => proposal.key)).toEqual(['audit:stale']);
    expect(HEALTHCARE_COMPLIANCE_EVIDENCE.detect({ evidence, pages: [verification] })).toEqual([]);
  });

  it('reconciles P&L patient revenue to collections by year, and reads denial write-offs across the years', () => {
    const pnl = (account: string, kind: string, amounts: readonly string[]) =>
      ['2023', '2024', '2025'].map((year, index) => row(`pnl:${account}:${year}`, 'finance.pnl_line', { account, month: year, amount: amounts[index] ?? '0', line_kind: kind }));
    // 2025 collections are 112,800; the P&L books 120,000 (6.4% more).
    const lines = [...pnl('Net patient service revenue', 'REVENUE', ['98400', '105600', '120000']), ...pnl('Denial write-offs', 'OPEX', ['1000', '2000', '4000'])];
    const reconciled = HEALTHCARE_COLLECTIONS_RECONCILIATION.detect({ evidence: [...evidence, ...lines], pages: [] });
    expect(reconciled.map((proposal) => [proposal.key, proposal.direction, proposal.severity])).toEqual([['2025', -1, 'HIGH']]);
    expect(HEALTHCARE_PNL_EXPENSE_OUTPACING.detect({ evidence: lines, pages: [] }).map((proposal) => proposal.key)).toEqual(['denials:2023-2025']);
  });

  it('keeps the T-061 rules first, unchanged, and every rule id unique', () => {
    expect(HEALTHCARE_RULES.slice(0, 4).map((rule) => rule.id)).toEqual(['healthcare-government-concentration', 'healthcare-director-fee', 'healthcare-privacy-assessment', 'healthcare-credentials-expiring']);
    expect(new Set(HEALTHCARE_RULES.map((rule) => rule.id)).size).toBe(16);
  });
});

describe('healthcare calculator (T-160)', () => {
  it('computes collections, denials, days in AR and the clinician share, and names the import a missing figure needs', () => {
    const report = HEALTHCARE_METRICS_CALCULATOR.compute({ currency: 'USD', evidence: [...remittances(), ...collections(), ...credentials] });
    const value = (key: string) => report.metrics.find((metric) => metric.key === key);
    expect(report).toMatchObject({ calculator: 'healthcare-collections', version: 'healthcare-collections-1' });
    expect(value('collected')?.value).toBe('112800.00');
    expect(value('denial_rate')?.value).toBe('0.1000');
    expect(value('top_clinician_share')?.value).toBe('0.5000');
    expect(value('credentials_expired')?.value).toBe('1');
    expect(value('contracts_expiring')).toMatchObject({ value: null, needs: ['HEALTHCARE_PAYER_CONTRACTS', 'HEALTHCARE_REMITTANCES'] });
    const empty = HEALTHCARE_METRICS_CALCULATOR.compute({ currency: 'USD', evidence: [] });
    expect(empty.metrics.find((metric) => metric.key === 'collected')).toMatchObject({ value: null, needs: ['HEALTHCARE_REMITTANCES'] });
  });
});
