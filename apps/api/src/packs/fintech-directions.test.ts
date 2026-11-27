import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FINTECH_RULES, type PackRuleEvidence, type PackRulePage } from '@pactlab/calculations';
import { defaultDirectionFor, DRIVER_TREND_SIGNAL, FINTECH_LICENCE_EVIDENCE_TYPE, FINTECH_PROCESSOR_MONTH_EVIDENCE_TYPE, PNL_LINE_EVIDENCE_TYPE } from '@pactlab/connectors';
import { applyMapping, IMPORT_TARGET_DEFINITIONS, PACKS, parseCsv, suggestFields, type ImportMapping } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Every fintech rule input maps to a finding through VALUATION_DIRECTION_MAP (T-159): each rule's
 * outcome names the evidence type and signal it rests on, and the direction it proposes is the map's
 * default for that signal. Run over the generated demo data, so every planted outcome is exercised.
 */
const SIGNALS: Readonly<Record<string, (key: string) => readonly [string, string] | null>> = {
  'fintech-credit-loss': () => ['fintech.loan', 'allowance-shortfall'],
  'fintech-aml-unreviewed': () => ['fintech.aml_alert', 'unreviewed-alerts'],
  // A document clause (T-058): a closing condition, decided by the clause's own rationale, not an evidence row.
  'fintech-partner-bank-coc': () => null,
  'fintech-volume-claims': (key) => [FINTECH_PROCESSOR_MONTH_EVIDENCE_TYPE, `claim-${key.split(':').pop() ?? ''}`],
  'fintech-revenue-reconciliation': () => [FINTECH_PROCESSOR_MONTH_EVIDENCE_TYPE, 'revenue-unreconciled'],
  'fintech-licence-status': (key) => [FINTECH_LICENCE_EVIDENCE_TYPE, key.endsWith(':lapsed') ? 'licence-lapsed' : 'licence-near-expiry'],
  'fintech-loss-thresholds': (key) => [FINTECH_PROCESSOR_MONTH_EVIDENCE_TYPE, key.endsWith(':breach') ? 'loss-threshold-breach' : 'loss-rate-rising'],
  'fintech-compliance-evidence': () => [FINTECH_PROCESSOR_MONTH_EVIDENCE_TYPE, 'compliance-gap'],
  'fintech-pnl-trend': () => [PNL_LINE_EVIDENCE_TYPE, 'trend'],
  'fintech-pnl-margin-drift': () => [PNL_LINE_EVIDENCE_TYPE, 'margin-drift'],
  'fintech-pnl-expense-outpacing': () => [PNL_LINE_EVIDENCE_TYPE, 'expense-outpacing'],
  // Driver trends over five years (T-184, T-184b): one driver-trend signal per evidence type.
  'fintech-take-rate-trend': () => [FINTECH_PROCESSOR_MONTH_EVIDENCE_TYPE, DRIVER_TREND_SIGNAL],
  'fintech-loss-rate-trend': () => [FINTECH_PROCESSOR_MONTH_EVIDENCE_TYPE, DRIVER_TREND_SIGNAL],
};

describe('fintech rules and the valuation direction map (T-159)', () => {
  let out = '';
  let evidence: PackRuleEvidence[] = [];
  let pages: PackRulePage[] = [];

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'pactlab-fintech-directions-'));
    const run = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/generate.py'), out], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
    const dir = join(out, 'fintech', 'USD');
    for (const target of PACKS.FINTECH.importTargets.slice(1)) {
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
    for (const rule of FINTECH_RULES) {
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
    for (const outcome of ['fintech-volume-claims:claim-contradicted', 'fintech-volume-claims:claim-verified', 'fintech-volume-claims:claim-unverified', 'fintech-licence-status:licence-lapsed', 'fintech-loss-thresholds:loss-threshold-breach', 'fintech-pnl-trend:trend', 'fintech-pnl-expense-outpacing:expense-outpacing', 'fintech-take-rate-trend:driver-trend']) {
      expect(seen, outcome).toContain(outcome);
    }
  });
});
