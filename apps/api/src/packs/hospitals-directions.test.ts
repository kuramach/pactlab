import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HEALTHCARE_RULES, HOSPITALS_RULES, type PackRuleEvidence, type PackRulePage } from '@pactlab/calculations';
import {
  defaultDirectionFor,
  DOCUMENT_FINDING_EVIDENCE_TYPE,
  DRIVER_TREND_SIGNAL,
  HEALTHCARE_CREDENTIAL_EVIDENCE_TYPE,
  HEALTHCARE_PAYER_CONTRACT_EVIDENCE_TYPE,
  HOSPITALS_CAPEX_YEAR_EVIDENCE_TYPE,
  HOSPITALS_CENSUS_MONTH_EVIDENCE_TYPE,
  HOSPITALS_COST_REPORT_YEAR_EVIDENCE_TYPE,
  PNL_LINE_EVIDENCE_TYPE,
} from '@pactlab/connectors';
import { applyMapping, IMPORT_TARGET_DEFINITIONS, PACKS, parseCsv, suggestFields, type ImportMapping } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Every hospitals rule input maps to a finding through VALUATION_DIRECTION_MAP (T-162): the hospital's own
 * rules and the T-061 healthcare rules it reuses by id, run over the generated hospitals demo data, each
 * outcome named by its evidence type and signal and proposing the map's default direction. The T-069 and
 * T-061 rules predate the map's entries and decide by their own rationale, unchanged. The rules draft
 * exactly the README's planted list.
 */
const SIGNALS: Readonly<Record<string, (key: string) => readonly [string, string] | null>> = {
  'hospitals-payer-concentration': () => null,
  'hospitals-accreditation-transfer': () => null,
  'hospitals-physician-dependence': () => null,
  'hospitals-regulatory-capex': () => null,
  'healthcare-director-fee': () => null,
  'healthcare-privacy-assessment': () => null,
  'hospitals-cost-report-claims': (key) => [HOSPITALS_COST_REPORT_YEAR_EVIDENCE_TYPE, `claim-${key.split(':').pop() ?? ''}`],
  'hospitals-cost-report-reconciliation': () => [HOSPITALS_COST_REPORT_YEAR_EVIDENCE_TYPE, 'cost-report-unreconciled'],
  'hospitals-payer-contracts': (key) => [HEALTHCARE_PAYER_CONTRACT_EVIDENCE_TYPE, key.startsWith('missing:') ? 'contract-missing' : 'contract-ends-near-closing'],
  'hospitals-medical-staff': (key) => [HEALTHCARE_CREDENTIAL_EVIDENCE_TYPE, key.startsWith('lapsed:') ? 'credential-lapsed' : key.startsWith('roster:') ? 'credential-missing' : 'privileges-lapse-together'],
  'hospitals-capex-trend': (key) => [HOSPITALS_CAPEX_YEAR_EVIDENCE_TYPE, key.endsWith(':claimed-modern') ? 'capex-falling-modern-claim' : 'capex-falling'],
  'hospitals-quality-claims': (key) => [DOCUMENT_FINDING_EVIDENCE_TYPE, `quality-claim-${key.split(':').pop() ?? ''}`],
  'hospitals-pnl-trend': () => [PNL_LINE_EVIDENCE_TYPE, 'trend'],
  'hospitals-pnl-margin-drift': () => [PNL_LINE_EVIDENCE_TYPE, 'margin-drift'],
  'hospitals-pnl-expense-outpacing': () => [PNL_LINE_EVIDENCE_TYPE, 'expense-outpacing'],
  'hospitals-admissions-trend': () => [HOSPITALS_CENSUS_MONTH_EVIDENCE_TYPE, DRIVER_TREND_SIGNAL],
  'hospitals-recent-run': () => [PNL_LINE_EVIDENCE_TYPE, 'recent-run'],
};
const RULES = new Map([...HOSPITALS_RULES, ...HEALTHCARE_RULES].map((rule) => [rule.id, rule]));

describe('hospitals rules and the valuation direction map (T-162)', () => {
  let out = '';
  let readme = '';
  let evidence: PackRuleEvidence[] = [];
  let pages: PackRulePage[] = [];

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'pactlab-hospitals-directions-'));
    const run = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/generate.py'), out], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
    const dir = join(out, 'hospitals', 'USD');
    readme = readFileSync(join(dir, 'README.md'), 'utf8');
    for (const target of PACKS.HOSPITALS.importTargets.slice(1)) {
      const definition = IMPORT_TARGET_DEFINITIONS[target];
      const csv = parseCsv(readFileSync(join(dir, definition.fileName), 'utf8'));
      const mapping: ImportMapping = { target, fields: suggestFields(definition, csv.header, {}), dateFormat: 'YYYY-MM-DD', numberFormat: 'DOT_DECIMAL', amountUnit: 'MAJOR', negateAmounts: false };
      for (const row of applyMapping(csv, mapping, 'pack', definition).rows) evidence.push({ id: `${target}:${row.row}`, evidenceType: definition.evidenceType, sourceRecordId: `${target}:${row.row}`, canonical: row.canonical });
    }
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

  it('every rule outcome proposes the direction the map gives its signal, and the rules draft the README’s list', () => {
    const seen = new Set<string>();
    const titles: string[] = [];
    for (const id of PACKS.HOSPITALS.findingRules) {
      const rule = RULES.get(id);
      expect(rule, id).toBeDefined();
      if (!rule) continue;
      const signalOf = SIGNALS[rule.id];
      expect(signalOf, rule.id).toBeDefined();
      for (const proposal of rule.detect({ evidence, pages: rule.readsDocuments ? pages : [] })) {
        titles.push(proposal.title);
        const signal = signalOf?.(proposal.key);
        if (!signal) continue;
        seen.add(`${rule.id}:${signal[1]}`);
        expect(defaultDirectionFor(signal[0], signal[1]), `${rule.id} ${proposal.key}`).toBe(proposal.direction);
      }
    }
    for (const outcome of [
      'hospitals-payer-contracts:contract-ends-near-closing',
      'hospitals-cost-report-claims:claim-contradicted',
      'hospitals-cost-report-claims:claim-verified',
      'hospitals-capex-trend:capex-falling-modern-claim',
      'hospitals-medical-staff:privileges-lapse-together',
      'hospitals-quality-claims:quality-claim-verified',
      'hospitals-quality-claims:quality-claim-unverified',
      'hospitals-pnl-trend:trend',
    ]) {
      expect(seen, outcome).toContain(outcome);
    }
    // The README lists every draft the rules make on this folder, and nothing else (the T-069 physician title is the README's shorthand).
    const listed = [...readme.matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(titles.length).toBe(listed.length);
    for (const title of titles.filter((title) => title !== 'Key-physician dependence')) expect(listed, title).toContain(title);
  });
});
