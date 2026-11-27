import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ECOMMERCE_RULES, type PackRuleEvidence, type PackRulePage } from '@pactlab/calculations';
import {
  defaultDirectionFor,
  DRIVER_TREND_SIGNAL,
  ECOMMERCE_AD_SPEND_MONTH_EVIDENCE_TYPE,
  ECOMMERCE_CHANNEL_MONTH_EVIDENCE_TYPE,
  ECOMMERCE_COHORT_MONTH_EVIDENCE_TYPE,
  ECOMMERCE_STOCK_LOT_EVIDENCE_TYPE,
  PNL_LINE_EVIDENCE_TYPE,
} from '@pactlab/connectors';
import { applyMapping, IMPORT_TARGET_DEFINITIONS, PACKS, parseCsv, suggestFields, type ImportMapping } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Every e-commerce rule input maps to a finding through VALUATION_DIRECTION_MAP (T-164): each rule's
 * outcome names the evidence type and signal it rests on, and the direction it proposes is the map's
 * default for that signal. Run over the generated demo data, so every planted outcome is exercised.
 */
const SIGNALS: Readonly<Record<string, (key: string) => readonly [string, string] | null>> = {
  // A marketplace clause (T-065): a channel-risk sensitivity, decided by the rule's own rationale, not an evidence row.
  'ecommerce-marketplace-majority': () => null,
  'ecommerce-cohort-repeat-decline': () => [ECOMMERCE_COHORT_MONTH_EVIDENCE_TYPE, 'repeat-decline'],
  'ecommerce-channel-cac-rising': () => [ECOMMERCE_AD_SPEND_MONTH_EVIDENCE_TYPE, 'channel-cac-rising'],
  'ecommerce-unit-economics-claims': (key) => [ECOMMERCE_CHANNEL_MONTH_EVIDENCE_TYPE, `claim-${key.split(':').pop() ?? ''}`],
  'ecommerce-channel-reconciliation': () => [ECOMMERCE_CHANNEL_MONTH_EVIDENCE_TYPE, 'revenue-unreconciled'],
  'ecommerce-platform-ownership': (key) => [ECOMMERCE_CHANNEL_MONTH_EVIDENCE_TYPE, key.endsWith(':personal') ? 'account-held-personally' : 'account-held-personally-minor'],
  'ecommerce-return-rate-trend': () => [ECOMMERCE_CHANNEL_MONTH_EVIDENCE_TYPE, 'return-rate-rising'],
  'ecommerce-inventory-ageing': () => [ECOMMERCE_STOCK_LOT_EVIDENCE_TYPE, 'aged-inventory'],
  'ecommerce-unit-economics-trend': (key) => [ECOMMERCE_CHANNEL_MONTH_EVIDENCE_TYPE, key.startsWith('cac:') ? 'cac-rising-by-year' : 'contribution-compressing'],
  'ecommerce-pnl-trend': () => [PNL_LINE_EVIDENCE_TYPE, 'trend'],
  'ecommerce-pnl-margin-drift': () => [PNL_LINE_EVIDENCE_TYPE, 'margin-drift'],
  'ecommerce-pnl-expense-outpacing': () => [PNL_LINE_EVIDENCE_TYPE, 'expense-outpacing'],
  'ecommerce-discount-trend': () => [ECOMMERCE_CHANNEL_MONTH_EVIDENCE_TYPE, DRIVER_TREND_SIGNAL],
};

describe('e-commerce rules and the valuation direction map (T-164)', () => {
  let out = '';
  let evidence: PackRuleEvidence[] = [];
  let pages: PackRulePage[] = [];

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'pactlab-ecommerce-directions-'));
    const run = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/generate.py'), out], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
    const dir = join(out, 'ecommerce-dtc', 'USD');
    for (const target of PACKS.ECOMMERCE_DTC.importTargets) {
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
    for (const rule of ECOMMERCE_RULES) {
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
      'ecommerce-unit-economics-claims:claim-contradicted',
      'ecommerce-unit-economics-claims:claim-verified',
      'ecommerce-platform-ownership:account-held-personally',
      'ecommerce-inventory-ageing:aged-inventory',
      'ecommerce-unit-economics-trend:cac-rising-by-year',
      'ecommerce-unit-economics-trend:contribution-compressing',
      'ecommerce-pnl-trend:trend',
      'ecommerce-pnl-expense-outpacing:expense-outpacing',
    ]) {
      expect(seen, outcome).toContain(outcome);
    }
  });

  it('the rules draft exactly the README’s findings from the demo data', () => {
    const titles = ECOMMERCE_RULES.flatMap((rule) => rule.detect({ evidence, pages: rule.readsDocuments ? pages : [] }).map((proposal) => proposal.title));
    const readme = readFileSync(join(out, 'ecommerce-dtc', 'USD', 'README.md'), 'utf8');
    const listed = [...(readme.split('You should see exactly these')[1]?.split('\n3. ')[0] ?? '').matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(titles.sort()).toEqual(listed.sort());
  });
});
