import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { COMMERCIAL_PROPERTY_RULES, type PackRuleEvidence, type PackRulePage } from '@pactlab/calculations';
import { CRE_CAM_CATEGORY_EVIDENCE_TYPE, CRE_CAPEX_ITEM_EVIDENCE_TYPE, CRE_LEASE_EVIDENCE_TYPE, defaultDirectionFor, PNL_LINE_EVIDENCE_TYPE } from '@pactlab/connectors';
import { applyMapping, IMPORT_TARGET_DEFINITIONS, PACKS, parseCsv, suggestFields, type ImportMapping } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Every commercial property rule input maps to a finding through VALUATION_DIRECTION_MAP (T-165), run over the
 * generated commercial-property demo data: each outcome named by its evidence type and signal and proposing the
 * map's default direction. The T-066 rules predate the map's entries and decide by their own rationale, unchanged.
 * The rules draft exactly the README's planted list.
 */
const SIGNALS: Readonly<Record<string, (key: string) => readonly [string, string] | null>> = {
  'cre-anchor-rollover': () => null,
  'cre-environmental-condition': () => null,
  'cre-cam-under-recovery': () => null,
  'cre-below-market-anchor': () => null,
  'cre-rent-roll-verification': (key) =>
    key.startsWith('overstated:')
      ? [CRE_LEASE_EVIDENCE_TYPE, 'rent-overstated']
      : key.startsWith('statements:')
        ? [CRE_LEASE_EVIDENCE_TYPE, 'statement-rent-exceeds-leases']
        : key.startsWith('missing:')
          ? [CRE_LEASE_EVIDENCE_TYPE, 'lease-missing']
          : [CRE_LEASE_EVIDENCE_TYPE, 'expiry-differs'],
  'cre-recovery-reconciliation': () => [CRE_CAM_CATEGORY_EVIDENCE_TYPE, 'recovery-shortfall-persistent'],
  'cre-obligations': () => [CRE_LEASE_EVIDENCE_TYPE, 'landlord-obligations'],
  'cre-rent-cliff': () => [CRE_LEASE_EVIDENCE_TYPE, 'rent-cliff'],
  'cre-condition-capex': (key) => [CRE_CAPEX_ITEM_EVIDENCE_TYPE, key.includes(':omitted:') ? 'condition-item-omitted' : 'condition-item-under-budgeted'],
  'cre-pnl-trend': () => [PNL_LINE_EVIDENCE_TYPE, 'trend'],
  'cre-pnl-margin-drift': () => [PNL_LINE_EVIDENCE_TYPE, 'margin-drift'],
  'cre-pnl-expense-outpacing': () => [PNL_LINE_EVIDENCE_TYPE, 'expense-outpacing'],
  'cre-recent-run': () => [PNL_LINE_EVIDENCE_TYPE, 'recent-run'],
};
const RULES = new Map(COMMERCIAL_PROPERTY_RULES.map((rule) => [rule.id, rule]));

describe('commercial property rules and the valuation direction map (T-165)', () => {
  let out = '';
  let readme = '';
  let evidence: PackRuleEvidence[] = [];
  let pages: PackRulePage[] = [];

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'pactlab-cre-directions-'));
    const run = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/generate.py'), out], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
    const dir = join(out, 'commercial-property', 'USD');
    readme = readFileSync(join(dir, 'README.md'), 'utf8');
    for (const target of PACKS.COMMERCIAL_PROPERTY.importTargets) {
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
    for (const id of PACKS.COMMERCIAL_PROPERTY.findingRules) {
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
      'cre-rent-roll-verification:rent-overstated',
      'cre-recovery-reconciliation:recovery-shortfall-persistent',
      'cre-obligations:landlord-obligations',
      'cre-rent-cliff:rent-cliff',
      'cre-condition-capex:condition-item-omitted',
      'cre-pnl-trend:trend',
    ]) {
      expect(seen, outcome).toContain(outcome);
    }
    // The README lists every draft the rules make on this folder, and nothing else (the T-066 upside title is the README's shorthand).
    const listed = [...readme.matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(titles.length).toBe(listed.length);
    for (const title of titles.filter((title) => title !== 'Below-market anchor rent (upside, not price)')) expect(listed, title).toContain(title);
  });
});
