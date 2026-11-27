import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TELECOM_RULES, type PackRuleEvidence, type PackRulePage } from '@pactlab/calculations';
import {
  defaultDirectionFor,
  DRIVER_TREND_SIGNAL,
  PNL_LINE_EVIDENCE_TYPE,
  TELECOM_AGREEMENT_EVIDENCE_TYPE,
  TELECOM_CAPEX_YEAR_EVIDENCE_TYPE,
  TELECOM_REVENUE_MONTH_EVIDENCE_TYPE,
  TELECOM_SUBSCRIBER_MOVEMENT_EVIDENCE_TYPE,
  TELECOM_SUBSCRIBERS_MONTH_EVIDENCE_TYPE,
} from '@pactlab/connectors';
import { applyMapping, IMPORT_TARGET_DEFINITIONS, PACKS, parseCsv, suggestFields, type ImportMapping } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Every telecom and media rule input maps to a finding through VALUATION_DIRECTION_MAP (T-168): each rule's
 * outcome names the evidence type and signal it rests on, and the direction it proposes is the map's
 * default for that signal. Run over the generated demo data, so every planted outcome is exercised.
 */
const SIGNALS: Readonly<Record<string, (key: string) => readonly [string, string] | null>> = {
  'telecom-reported-subscribers': () => [TELECOM_SUBSCRIBERS_MONTH_EVIDENCE_TYPE, 'reported-above-billed'],
  'telecom-churn-turning': () => [TELECOM_SUBSCRIBERS_MONTH_EVIDENCE_TYPE, 'churn-turning'],
  // A regional build-out sensitivity (T-062), neutral by the rule's own rationale over the billing lines.
  'telecom-regional-concentration': () => null,
  // A pricing clause (T-062): decided by the rule's own rationale against a document, not an evidence row.
  'telecom-wholesale-review': () => null,
  'telecom-subscriber-claims': (key) => [TELECOM_SUBSCRIBER_MOVEMENT_EVIDENCE_TYPE, `claim-${key.split(':').pop() ?? ''}`],
  'telecom-rights-window': () => [TELECOM_AGREEMENT_EVIDENCE_TYPE, 'agreement-ends-near-closing'],
  'telecom-counterparty-concentration': () => [TELECOM_REVENUE_MONTH_EVIDENCE_TYPE, 'counterparty-concentration'],
  'telecom-content-squeeze': () => [TELECOM_SUBSCRIBER_MOVEMENT_EVIDENCE_TYPE, 'content-squeeze'],
  'telecom-capex-squeeze': () => [TELECOM_CAPEX_YEAR_EVIDENCE_TYPE, 'capex-squeeze'],
  'telecom-pnl-trend': () => [PNL_LINE_EVIDENCE_TYPE, 'trend'],
  'telecom-pnl-margin-drift': () => [PNL_LINE_EVIDENCE_TYPE, 'margin-drift'],
  'telecom-pnl-expense-outpacing': () => [PNL_LINE_EVIDENCE_TYPE, 'expense-outpacing'],
  'telecom-recent-run': () => [PNL_LINE_EVIDENCE_TYPE, 'recent-run'],
  'telecom-churn-trend': () => [TELECOM_SUBSCRIBER_MOVEMENT_EVIDENCE_TYPE, DRIVER_TREND_SIGNAL],
};

describe('telecom and media rules and the valuation direction map (T-168)', () => {
  let out = '';
  let evidence: PackRuleEvidence[] = [];
  let pages: PackRulePage[] = [];

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'pactlab-telecom-directions-'));
    const run = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/generate.py'), out], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
    const dir = join(out, 'telecom-media', 'USD');
    for (const target of PACKS.TELECOM_MEDIA.importTargets) {
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
    for (const rule of TELECOM_RULES) {
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
      'telecom-reported-subscribers:reported-above-billed',
      'telecom-churn-turning:churn-turning',
      'telecom-subscriber-claims:claim-contradicted',
      'telecom-subscriber-claims:claim-verified',
      'telecom-rights-window:agreement-ends-near-closing',
      'telecom-counterparty-concentration:counterparty-concentration',
      'telecom-content-squeeze:content-squeeze',
      'telecom-pnl-trend:trend',
      'telecom-pnl-margin-drift:margin-drift',
      'telecom-pnl-expense-outpacing:expense-outpacing',
    ]) {
      expect(seen, outcome).toContain(outcome);
    }
  });

  it('the rules draft exactly the README’s findings from the demo data', () => {
    const titles = TELECOM_RULES.flatMap((rule) => rule.detect({ evidence, pages: rule.readsDocuments ? pages : [] }).map((proposal) => proposal.title));
    const readme = readFileSync(join(out, 'telecom-media', 'USD', 'README.md'), 'utf8');
    const listed = [...(readme.split('You should see exactly these')[1]?.split('\n3. ')[0] ?? '').matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(titles.sort()).toEqual(listed.sort());
  });
});
