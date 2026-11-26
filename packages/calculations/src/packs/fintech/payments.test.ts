import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { FINTECH_METRICS_CALCULATOR } from './metrics';
import { complianceDocuments, dateIn, licenceRows, licenceStatuses, paymentClaims, processorMonths, quarterlyRates, statedThresholds, volumeModel } from './payments';
import {
  FINTECH_COMPLIANCE_EVIDENCE,
  FINTECH_LICENCE_STATUS,
  FINTECH_LOSS_THRESHOLDS,
  FINTECH_PNL_EXPENSE_OUTPACING,
  FINTECH_PNL_MARGIN_DRIFT,
  FINTECH_PNL_TREND,
  FINTECH_REVENUE_RECONCILIATION,
  FINTECH_RULES,
  FINTECH_VOLUME_CLAIMS,
} from './rules';

const DOC = '01900000-0000-7000-8000-0000000f0001';
const page = (text: string, pageNumber = 1, documentId = DOC): PackRulePage => ({ documentId, pageNumber, text });
const MONTHS = Array.from({ length: 24 }, (_, index) => {
  const month = index + 9; // 2024-10 … 2026-09
  return `${2024 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}`;
});

/** Two processors, volume 1,000,000 a month each in the first year and 1,500,000 in the second; take rate 1%; chargebacks rising. */
function exports(chargebackLast = 120): PackRuleEvidence[] {
  return MONTHS.flatMap((month, index) =>
    ['Alpha Pay', 'Beta Bank'].map((processor) => {
      const volume = index < 12 ? 1_000_000 : 1_500_000;
      const quarter = Math.floor(index / 3);
      const chargebacks = index >= 21 ? chargebackLast : 40 + quarter * 5;
      return {
        id: `${month}:${processor}`,
        evidenceType: 'fintech.processor_month',
        sourceRecordId: `${month}|${processor}`,
        canonical: { month, processor, gross_volume: `${volume}.00`, transactions: '10000', net_revenue: `${volume / 100}.00`, chargeback_count: String(chargebacks), fraud_losses: '500.00' },
      };
    }),
  );
}
const TRAILING = 1_500_000 * 24;

describe('the fintech payments model (fintech-payments-1)', () => {
  it('recomputes trailing TPV, growth and the take rate from the exports, and quarters with all three months', () => {
    const rows = processorMonths(exports());
    const model = volumeModel(rows);
    expect(model.latestMonth).toBe('2026-09');
    expect(model.trailing?.volume.toFixed(2)).toBe(`${TRAILING}.00`);
    expect(model.growth?.toFixed(4)).toBe('0.5000');
    expect(model.trailing?.takeRate?.toFixed(4)).toBe('0.0100');
    const quarters = quarterlyRates(rows);
    expect(quarters.at(-1)).toMatchObject({ quarter: '2026-Q3' });
    expect(quarters.at(-1)?.chargebackRate?.toFixed(4)).toBe('0.0120');
    // 2024-Q4 is complete (Oct–Dec); nothing partial is kept.
    expect(quarters.map((quarter) => quarter.quarter)[0]).toBe('2024-Q4');
  });

  it('reads thresholds, claims, dates and compliance headings from the documents', () => {
    const covenant = page('8.2 The Program Manager shall keep the chargeback ratio, measured each calendar quarter as chargebacks divided by settled transactions by count, below 0.90%. 8.3 Fraud losses shall not exceed 0.15% of processed volume in any calendar quarter.');
    expect(statedThresholds([covenant]).map((entry) => [entry.measure, entry.limit.toFixed(4), entry.basis, entry.strict])).toEqual([
      ['CHARGEBACK', '0.0090', 'COUNT', true],
      ['FRAUD', '0.0015', 'VOLUME', false],
    ]);
    const deck = page('Total payment volume (TPV), twelve months to September 2026: USD 36,000,000. TPV grew 50% year on year. Effective take rate: 1.00%. Net revenue retention: 118%.');
    expect(paymentClaims([deck]).map((claim) => [claim.key, claim.value.toFixed(0), claim.month])).toEqual([
      ['TPV', '36000000', '2026-09'],
      ['TPV_GROWTH', '50', null],
      ['TAKE_RATE', '1', null],
      ['RETENTION', '118', null],
    ]);
    expect([dateIn('expires on 31 May 2026.'), dateIn('expires May 31, 2026'), dateIn('valid to 2027-01-15')]).toEqual(['2026-05-31', '2026-05-31', '2027-01-15']);
    const found = complianceDocuments([page('PCI DSS Attestation of Compliance (synthetic). Date of attestation: 15 March 2026.', 1, 'd1'), page('BSA/AML programme (synthetic). Approved by the board.', 1, 'd2'), page('Consent order with the Department of Banking (synthetic).', 1, 'd3')]);
    expect(found.map((entry) => [entry.kind, entry.date, entry.consentOrder])).toEqual([
      ['PCI_ATTESTATION', '2026-03-15', false],
      ['AML_PROGRAM', null, false],
      ['REGULATORY_EXAM', null, true],
    ]);
  });
});

describe('fintech payments and licence rules (T-159)', () => {
  it('TPV that double-counts one processor month is contradicted and names the month; growth and take rate verify; retention stays unverified', () => {
    const doubled = TRAILING + 1_500_000;
    const deck = page(`Total payment volume (TPV), twelve months to September 2026: USD ${doubled.toLocaleString('en-US')}. TPV grew 50% year on year. Effective take rate: 1.00%. Net revenue retention: 118%.`);
    const proposals = FINTECH_VOLUME_CLAIMS.detect({ evidence: exports(), pages: [deck] });
    const byKey = Object.fromEntries(proposals.map((proposal) => [proposal.key, proposal]));
    expect(byKey['TPV:contradicted']).toMatchObject({ direction: -1, claim: { status: 'CONTRADICTED' } });
    expect(byKey['TPV:contradicted']?.description).toContain('counted twice');
    expect(byKey['TPV:contradicted']?.quotes?.[0]?.quote).toMatch(/^Total payment volume/);
    expect(byKey['TPV_GROWTH:verified']).toMatchObject({ direction: 1, claim: { status: 'VERIFIED' } });
    expect(byKey['TAKE_RATE:verified']).toMatchObject({ direction: 1 });
    expect(byKey['RETENTION:unverified']).toMatchObject({ direction: 0, claim: { status: 'UNVERIFIED' } });
    // The true figure verifies.
    const honest = FINTECH_VOLUME_CLAIMS.detect({ evidence: exports(), pages: [page(`Total payment volume (TPV): USD ${TRAILING.toLocaleString('en-US')}.`)] });
    expect(honest.map((proposal) => proposal.key)).toEqual(['TPV:verified']);
  });

  it('the latest quarter breaching the sponsor covenant is a drag citing the clause; under it, a rise is a watch item', () => {
    const covenant = page('8.2 The Program Manager shall keep the chargeback ratio, measured each calendar quarter as chargebacks divided by settled transactions by count, below 0.90%.');
    const [breach, ...rest] = FINTECH_LOSS_THRESHOLDS.detect({ evidence: exports(), pages: [covenant] });
    expect(rest).toEqual([]);
    expect(breach).toMatchObject({ key: 'CHARGEBACK:2026-Q3:breach', direction: -1, severity: 'HIGH', pricedRisk: null });
    expect(breach?.description).toContain('1.20%');
    expect(breach?.quotes?.[0]?.quote).toMatch(/^8\.2 The Program Manager/);
    const watch = FINTECH_LOSS_THRESHOLDS.detect({ evidence: exports(80), pages: [covenant] });
    expect(watch.map((proposal) => [proposal.key, proposal.direction])).toEqual([['CHARGEBACK:2026-Q3:rising', 0]]);
  });

  it('a licence past its document expiry is a lapse; one expiring within 90 days is a closing condition; status and dates only', () => {
    const register = [
      { id: 'r1', evidenceType: 'fintech.licence', sourceRecordId: 'MT-OH-1', canonical: { licence_id: 'MT-OH-1', kind: 'money_transmitter', jurisdiction: 'Ohio', authority: 'Ohio Division of Financial Institutions', status: 'active', issued_on: '2021-06-01', expires_on: '2026-12-31' } },
      { id: 'r2', evidenceType: 'fintech.licence', sourceRecordId: 'MT-TX-2', canonical: { licence_id: 'MT-TX-2', kind: 'money_transmitter', jurisdiction: 'Texas', authority: 'Texas Department of Banking', status: 'active', issued_on: '2022-01-01', expires_on: '2026-11-30' } },
      { id: 'r3', evidenceType: 'fintech.licence', sourceRecordId: 'SB-1', canonical: { licence_id: 'SB-1', kind: 'sponsor_bank', jurisdiction: 'United States', authority: 'Lakeshore Bank', status: 'active', issued_on: '2023-04-01', expires_on: '2028-03-31' } },
    ];
    const licence = page('Ohio money transmitter licence (synthetic). Licence number MT-OH-1 was issued on 1 June 2021 and expires on 31 May 2026.');
    const statuses = licenceStatuses(licenceRows(register), [licence], '2026-09-30');
    expect(statuses.map((status) => [status.row.licenceId, status.state, status.registerDiffers])).toEqual([
      ['MT-OH-1', 'LAPSED', true],
      ['MT-TX-2', 'NEAR_EXPIRY', false],
      ['SB-1', 'ACTIVE', false],
    ]);
    const proposals = FINTECH_LICENCE_STATUS.detect({ evidence: [...register, ...exports()], pages: [licence] });
    expect(proposals.map((proposal) => [proposal.key, proposal.direction])).toEqual([
      ['MT-OH-1:lapsed', -1],
      ['MT-TX-2:2026-11-30:near-expiry', 0],
    ]);
    expect(proposals[0]?.description).toContain('expired on 2026-05-31, 4 months before');
    expect(proposals[0]?.description).toContain('for counsel');
    expect(proposals[0]?.quotes?.[0]?.quote).toContain('expires on 31 May 2026');
  });

  it('a stale attestation and a consent order are drafted, cited to their heading; missing evidence is never drafted (it has nothing to cite)', () => {
    const proposals = FINTECH_COMPLIANCE_EVIDENCE.detect({
      evidence: exports(),
      pages: [page('PCI DSS Attestation of Compliance (synthetic). Date of attestation: 1 March 2025.', 1, 'd1'), page('Consent order with the Department of Banking (synthetic).', 1, 'd2')],
    });
    expect(proposals.map((proposal) => [proposal.key, proposal.direction, proposal.quotes?.length])).toEqual([
      ['d1:stale', 0, 1],
      ['d2:consent-order', 0, 1],
    ]);
    expect(FINTECH_COMPLIANCE_EVIDENCE.detect({ evidence: exports(), pages: [] })).toEqual([]);
  });

  it('reconciles the P&L payments revenue to the exports, and reads the trend across years: fraud outpacing revenue is a finding one year would miss', () => {
    const pnl = (id: string, account: string, year: string, amount: string, kind: string): PackRuleEvidence => ({ id, evidenceType: 'finance.pnl_line', sourceRecordId: `${account}|${year}`, canonical: { account, month: year, amount, line_kind: kind } });
    const lines = [
      pnl('y1', 'Payment processing revenue', '2023', '1000000.00', 'REVENUE'),
      pnl('y2', 'Fraud losses', '2023', '8000.00', 'OPEX'),
      pnl('y3', 'Payment processing revenue', '2024', '1200000.00', 'REVENUE'),
      pnl('y4', 'Fraud losses', '2024', '14400.00', 'OPEX'),
      pnl('y5', 'Payment processing revenue', '2025', '200000.00', 'REVENUE'),
      pnl('y6', 'Fraud losses', '2025', '4000.00', 'OPEX'),
    ];
    // 2025: the exports give 12 × (10,000 + 15,000 … ) — only months 2025-01 … 2025-12 count.
    const reconciliation = FINTECH_REVENUE_RECONCILIATION.detect({ evidence: [...exports(), ...lines], pages: [] });
    expect(reconciliation.map((proposal) => proposal.key)).toEqual(['2025']);
    const outpacing = FINTECH_PNL_EXPENSE_OUTPACING.detect({ evidence: lines, pages: [] });
    expect(outpacing.map((proposal) => [proposal.key, proposal.direction])).toEqual([['fraud:2023-2025', -1]]);
    expect(outpacing[0]?.description).toContain('A single year shows 2.0%');
    // One year alone: the trend reads one year and nothing else fires.
    const one = lines.filter((row) => row.canonical['month'] === '2025');
    expect(FINTECH_PNL_TREND.detect({ evidence: one, pages: [] })[0]?.title).toBe('P&L for 2025: one year imported');
    expect(FINTECH_PNL_EXPENSE_OUTPACING.detect({ evidence: one, pages: [] })).toEqual([]);
    expect(FINTECH_PNL_MARGIN_DRIFT.detect({ evidence: lines, pages: [] })).toEqual([]);
  });

  it('no rule ever drafts without a citation, whatever is missing (the runner refuses an uncited finding)', () => {
    const inputs = [
      { evidence: [], pages: [] },
      { evidence: exports(), pages: [] },
      { evidence: [], pages: [page('Total payment volume (TPV): USD 1,000. Effective take rate: 1%. Net revenue retention: 90%. Chargeback ratio below 0.50%.')] },
      { evidence: exports(), pages: [page('PCI DSS Attestation of Compliance. Date of attestation: 1 January 2020.')] },
    ];
    for (const rule of FINTECH_RULES) {
      for (const input of inputs) {
        for (const proposal of rule.detect(input)) expect(proposal.evidenceIds.length + (proposal.quotes?.length ?? 0), `${rule.id} ${proposal.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('every rule is deterministic: the same inputs give the same drafts', () => {
    const pages = [page('Total payment volume (TPV): USD 1,000.'), page('chargeback ratio below 0.50% by count.', 2)];
    for (const rule of FINTECH_RULES) expect(rule.detect({ evidence: exports(), pages }), rule.id).toEqual(rule.detect({ evidence: exports(), pages }));
  });

  it('the calculator gives TPV, take rate and loss rates with formulas and counts, and names the import a missing figure needs', () => {
    const report = FINTECH_METRICS_CALCULATOR.compute({ currency: 'USD', evidence: exports() });
    const byKey = Object.fromEntries(report.metrics.map((metric) => [metric.key, metric]));
    expect(report).toMatchObject({ calculator: 'fintech-payments', version: 'fintech-payments-1' });
    expect(byKey['tpv']).toMatchObject({ value: `${TRAILING}.00`, sourceCount: 24 });
    expect(byKey['take_rate']?.value).toBe('0.010000');
    expect(byKey['licences']).toMatchObject({ value: null, needs: ['FINTECH_LICENCES'] });
  });
});
