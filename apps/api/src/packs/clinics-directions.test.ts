import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CLINICS_RULES, HEALTHCARE_RULES, type PackRuleEvidence, type PackRulePage } from '@pactlab/calculations';
import {
  CLINICS_REFERRAL_MONTH_EVIDENCE_TYPE,
  CLINICS_SERVICE_LINE_MONTH_EVIDENCE_TYPE,
  defaultDirectionFor,
  DRIVER_TREND_SIGNAL,
  DOCUMENT_FINDING_EVIDENCE_TYPE,
  HEALTHCARE_CLINICIAN_MONTH_EVIDENCE_TYPE,
  HEALTHCARE_CREDENTIAL_EVIDENCE_TYPE,
  HEALTHCARE_PAYER_CONTRACT_EVIDENCE_TYPE,
  HEALTHCARE_REMITTANCE_MONTH_EVIDENCE_TYPE,
  PNL_LINE_EVIDENCE_TYPE,
} from '@pactlab/connectors';
import { applyMapping, IMPORT_TARGET_DEFINITIONS, PACKS, parseCsv, suggestFields, type ImportMapping } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Every small clinics rule input maps to a finding through VALUATION_DIRECTION_MAP (T-161): the clinic's
 * own rules and the T-160 healthcare rules it reuses by id, run over the generated small-clinics demo
 * data, each outcome named by its evidence type and signal and proposing the map's default direction.
 * The T-068 and T-061 rules predate the map's entries and decide by their own rationale, unchanged.
 */
const SIGNALS: Readonly<Record<string, (key: string) => readonly [string, string] | null>> = {
  'healthcare-government-concentration': () => null,
  'healthcare-director-fee': () => null,
  'healthcare-privacy-assessment': () => null,
  'healthcare-credentials-expiring': () => null,
  'healthcare-practice-claims': (key) => [HEALTHCARE_REMITTANCE_MONTH_EVIDENCE_TYPE, `claim-${key.split(':').pop() ?? ''}`],
  'healthcare-collections-reconciliation': () => [HEALTHCARE_REMITTANCE_MONTH_EVIDENCE_TYPE, 'collections-unreconciled'],
  'healthcare-collections-trend': (key) => [HEALTHCARE_REMITTANCE_MONTH_EVIDENCE_TYPE, key.endsWith(':denials') ? 'denial-rate-rising' : 'days-in-ar-rising'],
  'healthcare-payer-mix-shift': () => [HEALTHCARE_REMITTANCE_MONTH_EVIDENCE_TYPE, 'payer-mix-shift'],
  'healthcare-credentialing': (key) => [
    HEALTHCARE_CREDENTIAL_EVIDENCE_TYPE,
    key.endsWith(':practising') ? 'practising-expired' : key.endsWith(':lapsed') ? 'credential-lapsed' : key.endsWith(':near-expiry') ? 'credential-near-expiry' : 'credential-missing',
  ],
  'healthcare-clinician-concentration': () => [HEALTHCARE_CLINICIAN_MONTH_EVIDENCE_TYPE, 'clinician-concentration'],
  'healthcare-payer-contracts': (key) => [HEALTHCARE_PAYER_CONTRACT_EVIDENCE_TYPE, key.endsWith(':expired') ? 'contract-expired' : key.endsWith(':expiring') ? 'contract-expiring' : 'contract-missing'],
  'healthcare-compliance-evidence': () => [HEALTHCARE_REMITTANCE_MONTH_EVIDENCE_TYPE, 'compliance-gap'],
  'clinics-provider-carries-site': () => null,
  'clinics-coding-above-policy': () => null,
  'clinics-equipment-past-life': () => null,
  'clinics-owner-dependence': (key) => [CLINICS_SERVICE_LINE_MONTH_EVIDENCE_TYPE, key.endsWith(':sole') ? 'owner-sole-provider' : 'owner-no-succession'],
  'clinics-referral-concentration': () => [CLINICS_REFERRAL_MONTH_EVIDENCE_TYPE, 'referral-concentration'],
  'clinics-premises': (key) => [DOCUMENT_FINDING_EVIDENCE_TYPE, key.endsWith(':short-term') ? 'lease-short-term' : 'lease-assignment-consent'],
  'clinics-pnl-trend': () => [PNL_LINE_EVIDENCE_TYPE, 'trend'],
  'clinics-pnl-margin-drift': () => [PNL_LINE_EVIDENCE_TYPE, 'margin-drift'],
  'clinics-pnl-expense-outpacing': () => [PNL_LINE_EVIDENCE_TYPE, 'expense-outpacing'],
  'healthcare-visits-trend': () => [HEALTHCARE_CLINICIAN_MONTH_EVIDENCE_TYPE, DRIVER_TREND_SIGNAL],
};
const RULES = new Map([...CLINICS_RULES, ...HEALTHCARE_RULES].map((rule) => [rule.id, rule]));

describe('small clinics rules and the valuation direction map (T-161)', () => {
  let out = '';
  let evidence: PackRuleEvidence[] = [];
  let pages: PackRulePage[] = [];

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'pactlab-clinics-directions-'));
    const run = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/generate.py'), out], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
    const dir = join(out, 'small-clinics', 'USD');
    for (const target of PACKS.SMALL_CLINICS.importTargets.slice(1)) {
      const definition = IMPORT_TARGET_DEFINITIONS[target];
      const csv = parseCsv(readFileSync(join(dir, definition.fileName), 'utf8'));
      const mapping: ImportMapping = { target, fields: suggestFields(definition, csv.header, {}), dateFormat: 'YYYY-MM-DD', numberFormat: 'DOT_DECIMAL', amountUnit: 'MAJOR', negateAmounts: false };
      for (const row of applyMapping(csv, mapping, 'pack', definition).rows) evidence.push({ id: `${target}:${row.row}`, evidenceType: definition.evidenceType, sourceRecordId: `${target}:${row.row}`, canonical: row.canonical });
    }
    // The P&L, by year, as the import reads it (years across; line kinds as a person confirms them).
    const [header = '', ...lines] = readFileSync(join(dir, 'pnl.csv'), 'utf8').trim().split('\n');
    const years = header.split(',').slice(1).map((year) => year.replace(/^FY/, ''));
    for (const line of lines) {
      const [account = '', ...amounts] = line.split(',');
      const kind = /revenue/i.test(account) ? 'REVENUE' : /^cost of/i.test(account) ? 'COGS' : 'OPEX';
      amounts.forEach((amount, index) => evidence.push({ id: `pnl:${account}:${years[index]}`, evidenceType: PNL_LINE_EVIDENCE_TYPE, sourceRecordId: `${account}|${years[index]}`, canonical: { account, month: years[index] ?? '', amount, line_kind: kind } }));
    }
    let documentIndex = 0;
    for (const file of readdirSync(join(dir, 'documents')).filter((name) => name.endsWith('.md')).sort()) {
      documentIndex += 1;
      const documentId = `0190f000-0000-7000-8000-${String(documentIndex).padStart(12, '0')}`;
      readFileSync(join(dir, 'documents', file), 'utf8')
        .split(/^---page---$/m)
        .forEach((text, index) => pages.push({ documentId, pageNumber: index + 1, text }));
    }
  }, 60_000);
  afterAll(() => {
    if (out) rmSync(out, { recursive: true, force: true });
    evidence = [];
    pages = [];
  });

  it('every rule outcome proposes the direction the map gives its signal', () => {
    const seen = new Set<string>();
    for (const id of PACKS.SMALL_CLINICS.findingRules) {
      const rule = RULES.get(id);
      expect(rule, id).toBeDefined();
      if (!rule) continue;
      const signalOf = SIGNALS[rule.id];
      expect(signalOf, rule.id).toBeDefined();
      for (const proposal of rule.detect({ evidence, pages: rule.readsDocuments ? pages : [] })) {
        const signal = signalOf?.(proposal.key);
        if (!signal) continue;
        seen.add(`${rule.id}:${signal[1]}`);
        expect(defaultDirectionFor(signal[0], signal[1]), `${rule.id} ${proposal.key}`).toBe(proposal.direction);
      }
    }
    // The planted outcomes are among those checked.
    for (const outcome of [
      'clinics-referral-concentration:referral-concentration',
      'clinics-premises:lease-short-term',
      'clinics-premises:lease-assignment-consent',
      'clinics-owner-dependence:owner-sole-provider',
      'healthcare-practice-claims:claim-verified',
      'clinics-pnl-trend:trend',
      'clinics-pnl-expense-outpacing:expense-outpacing',
    ]) {
      expect(seen, outcome).toContain(outcome);
    }
  });
});
