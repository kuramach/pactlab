import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HEALTHCARE_RULES, HOSPITALS_RULES, type PackRuleEvidence, type PackRulePage } from '@pactlab/calculations';
import { defaultDirectionFor, DOCUMENT_FINDING_EVIDENCE_TYPE, HOSPITALS_MEDICAL_STAFF_EVIDENCE_TYPE, HOSPITALS_PAYER_MONTH_EVIDENCE_TYPE, PNL_LINE_EVIDENCE_TYPE } from '@pactlab/connectors';
import { applyMapping, IMPORT_TARGET_DEFINITIONS, PACKS, parseCsv, suggestFields, type ImportMapping } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Every hospitals rule input maps to a finding through VALUATION_DIRECTION_MAP (T-162): the T-162 rules,
 * run over the generated hospitals demo data, each outcome named by its evidence type and signal and
 * proposing the map's default direction. The T-069 rules and the T-061 healthcare rules it reuses predate
 * the map's entries and decide by their own rationale, unchanged.
 */
const claimSignal = (prefix: string, key: string) => `${prefix}-claim-${key.split(':').pop() ?? ''}`;
const SIGNALS: Readonly<Record<string, (key: string) => readonly [string, string] | null>> = {
  'hospitals-payer-concentration': () => null,
  'hospitals-accreditation-transfer': () => null,
  'hospitals-physician-dependence': () => null,
  'hospitals-regulatory-capex': () => null,
  'healthcare-director-fee': () => null,
  'healthcare-privacy-assessment': () => null,
  'hospitals-cost-report-reconciliation': (key) => (key.endsWith(':costs') ? [PNL_LINE_EVIDENCE_TYPE, 'cost-report-unreconciled'] : [DOCUMENT_FINDING_EVIDENCE_TYPE, claimSignal('cost-report', key)]),
  'hospitals-payer-contracts': (key) => [HOSPITALS_PAYER_MONTH_EVIDENCE_TYPE, key.endsWith(':expired') ? 'payer-contract-expired' : 'payer-contract-expiring'],
  'hospitals-medical-staff': (key) => [HOSPITALS_MEDICAL_STAFF_EVIDENCE_TYPE, key.endsWith(':lapsed') ? 'department-privileges-lapsed' : key.endsWith(':due') ? 'department-privileges-due' : 'licence-expired'],
  'hospitals-plant-capex': () => [PNL_LINE_EVIDENCE_TYPE, 'capex-ratio-falling'],
  'hospitals-quality-claims': (key) => [DOCUMENT_FINDING_EVIDENCE_TYPE, claimSignal('quality', key)],
  'hospitals-pnl-trend': () => [PNL_LINE_EVIDENCE_TYPE, 'trend'],
  'hospitals-pnl-margin-drift': () => [PNL_LINE_EVIDENCE_TYPE, 'margin-drift'],
  'hospitals-pnl-expense-outpacing': () => [PNL_LINE_EVIDENCE_TYPE, 'expense-outpacing'],
};
const RULES = new Map([...HOSPITALS_RULES, ...HEALTHCARE_RULES].map((rule) => [rule.id, rule]));

describe('hospitals rules and the valuation direction map (T-162)', () => {
  let out = '';
  let evidence: PackRuleEvidence[] = [];
  let pages: PackRulePage[] = [];

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'pactlab-hospitals-directions-'));
    const run = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/generate.py'), out], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
    const dir = join(out, 'hospitals', 'USD');
    for (const target of PACKS.HOSPITALS.importTargets.slice(1)) {
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
    for (const id of PACKS.HOSPITALS.findingRules) {
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
      'hospitals-payer-contracts:payer-contract-expiring',
      'hospitals-cost-report-reconciliation:cost-report-claim-contradicted',
      'hospitals-cost-report-reconciliation:cost-report-claim-verified',
      'hospitals-plant-capex:capex-ratio-falling',
      'hospitals-medical-staff:department-privileges-lapsed',
      'hospitals-quality-claims:quality-claim-verified',
      'hospitals-pnl-trend:trend',
    ]) {
      expect(seen, outcome).toContain(outcome);
    }
  });
});
