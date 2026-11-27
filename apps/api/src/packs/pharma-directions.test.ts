import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PHARMA_RULES, type PackRuleEvidence, type PackRulePage } from '@pactlab/calculations';
import {
  defaultDirectionFor,
  DRIVER_TREND_SIGNAL,
  INVOICE_LINE_EVIDENCE_TYPE,
  DOCUMENT_FINDING_EVIDENCE_TYPE,
  PHARMA_OBLIGATION_EVIDENCE_TYPE,
  PHARMA_PATENT_EVIDENCE_TYPE,
  PHARMA_PROGRAMME_EVIDENCE_TYPE,
  PHARMA_REGISTRY_TRIAL_EVIDENCE_TYPE,
  PHARMA_SCIENTIST_EVIDENCE_TYPE,
  PNL_LINE_EVIDENCE_TYPE,
} from '@pactlab/connectors';
import { applyMapping, IMPORT_TARGET_DEFINITIONS, PACKS, parseCsv, suggestFields, type ImportMapping } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Every pharma rule input maps to a finding through VALUATION_DIRECTION_MAP (T-163): the rules run over the
 * generated pharma-biotech demo data, each outcome named by its evidence type and signal and proposing the
 * map's default direction. The T-064 rules predate the map's entries and decide by their own rationale.
 */
const SIGNALS: Readonly<Record<string, (key: string) => readonly [string, string] | null>> = {
  'pharma-patent-before-forecast': () => null,
  'pharma-supplier-observations': () => null,
  'pharma-partner-concentration': () => null,
  'pharma-pipeline-claims': (key) => (key.includes(':status:') ? [PHARMA_REGISTRY_TRIAL_EVIDENCE_TYPE, 'trials-halted'] : [PHARMA_PROGRAMME_EVIDENCE_TYPE, `claim-${key.split(':').pop() ?? ''}`]),
  'pharma-patent-cliff': () => [PHARMA_PATENT_EVIDENCE_TYPE, 'patent-cliff-in-hold'],
  'pharma-obligations': (key) => [PHARMA_OBLIGATION_EVIDENCE_TYPE, key.endsWith(':omitted') ? 'obligation-omitted' : key.endsWith(':understated') ? 'obligation-understated' : 'royalty-rate-understated'],
  'pharma-manufacturing-dependence': () => [DOCUMENT_FINDING_EVIDENCE_TYPE, 'single-source-manufacturing'],
  'pharma-key-scientist': () => [PHARMA_SCIENTIST_EVIDENCE_TYPE, 'key-scientist-concentration'],
  'pharma-burn-vs-timeline': () => [PNL_LINE_EVIDENCE_TYPE, 'rd-flat-timeline-accelerated'],
  'pharma-pnl-trend': () => [PNL_LINE_EVIDENCE_TYPE, 'trend'],
  'pharma-pnl-margin-drift': () => [PNL_LINE_EVIDENCE_TYPE, 'margin-drift'],
  'pharma-pnl-expense-outpacing': () => [PNL_LINE_EVIDENCE_TYPE, 'expense-outpacing'],
  'pharma-product-revenue-trend': () => [INVOICE_LINE_EVIDENCE_TYPE, DRIVER_TREND_SIGNAL],
};
const RULES = new Map(PHARMA_RULES.map((rule) => [rule.id, rule]));

describe('pharma rules and the valuation direction map (T-163)', () => {
  let out = '';
  let evidence: PackRuleEvidence[] = [];
  let pages: PackRulePage[] = [];

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'pactlab-pharma-directions-'));
    const run = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/generate.py'), out], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
    const dir = join(out, 'pharma-biotech', 'USD');
    for (const target of PACKS.PHARMA_BIOTECH.importTargets) {
      const definition = IMPORT_TARGET_DEFINITIONS[target];
      const csv = parseCsv(readFileSync(join(dir, definition.fileName), 'utf8'));
      const mapping: ImportMapping = { target, fields: suggestFields(definition, csv.header, {}), dateFormat: 'YYYY-MM-DD', numberFormat: 'DOT_DECIMAL', amountUnit: 'MAJOR', negateAmounts: false };
      for (const row of applyMapping(csv, mapping, target === 'BILLING_INVOICE_LINE' ? 'billing' : 'pack', definition).rows) evidence.push({ id: `${target}:${row.row}`, evidenceType: definition.evidenceType, sourceRecordId: `${target}:${row.row}`, canonical: row.canonical });
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
    for (const id of PACKS.PHARMA_BIOTECH.findingRules) {
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
      'pharma-pipeline-claims:claim-contradicted',
      'pharma-pipeline-claims:claim-verified',
      'pharma-pipeline-claims:claim-unverified',
      'pharma-patent-cliff:patent-cliff-in-hold',
      'pharma-obligations:obligation-omitted',
      'pharma-manufacturing-dependence:single-source-manufacturing',
      'pharma-key-scientist:key-scientist-concentration',
      'pharma-burn-vs-timeline:rd-flat-timeline-accelerated',
      'pharma-pnl-trend:trend',
      'pharma-product-revenue-trend:driver-trend',
    ]) {
      expect(seen, outcome).toContain(outcome);
    }
  });
});
