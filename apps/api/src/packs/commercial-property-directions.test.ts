import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { COMMERCIAL_PROPERTY_RULES, type PackRuleEvidence, type PackRulePage } from '@pactlab/calculations';
import { CRE_CAM_CATEGORY_EVIDENCE_TYPE, CRE_CAPEX_ITEM_EVIDENCE_TYPE, CRE_LEASE_EVIDENCE_TYPE, defaultDirectionFor, PNL_LINE_EVIDENCE_TYPE } from '@pactlab/connectors';
import { applyMapping, IMPORT_TARGET_DEFINITIONS, PACKS, parseCsv, suggestFields, type ImportMapping } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Every commercial-property rule input maps to a finding through VALUATION_DIRECTION_MAP (T-165): each rule's
 * outcome names the evidence type and signal it rests on, and the direction it proposes is the map's default
 * for that signal. Run over the generated demo data, so every planted outcome is exercised; the cushion
 * asymmetry holds (the below-market anchor is +1 confirmed value, never a price input).
 */
const SIGNALS: Readonly<Record<string, (key: string) => readonly [string, string] | null>> = {
  'cre-anchor-rollover': () => [CRE_LEASE_EVIDENCE_TYPE, 'anchor-rollover'],
  // A Phase I clause (T-066): its direction is the rule's own rationale, not an evidence row.
  'cre-environmental-condition': () => null,
  'cre-cam-under-recovery': () => [CRE_CAM_CATEGORY_EVIDENCE_TYPE, 'cam-under-recovery'],
  'cre-below-market-anchor': () => [CRE_LEASE_EVIDENCE_TYPE, 'below-market-anchor'],
  'cre-rent-roll-verification': (key) => [CRE_LEASE_EVIDENCE_TYPE, key.startsWith('rent:') ? 'rent-overstated' : 'expiry-mismatch'],
  'cre-rent-statement-reconciliation': () => [PNL_LINE_EVIDENCE_TYPE, 'rent-unreconciled'],
  'cre-recovery-shortfall': () => [PNL_LINE_EVIDENCE_TYPE, 'recovery-shortfall'],
  'cre-obligations': () => [CRE_LEASE_EVIDENCE_TYPE, 'landlord-obligations'],
  'cre-expiry-cliff': () => [CRE_LEASE_EVIDENCE_TYPE, 'expiry-cliff'],
  'cre-condition-capex-gap': () => [CRE_CAPEX_ITEM_EVIDENCE_TYPE, 'condition-item-unscheduled'],
  'cre-pnl-trend': () => [PNL_LINE_EVIDENCE_TYPE, 'trend'],
  'cre-pnl-margin-drift': () => [PNL_LINE_EVIDENCE_TYPE, 'margin-drift'],
  'cre-pnl-expense-outpacing': () => [PNL_LINE_EVIDENCE_TYPE, 'expense-outpacing'],
};

describe('commercial-property rules and the valuation direction map (T-165)', () => {
  let out = '';
  let evidence: PackRuleEvidence[] = [];
  let pages: PackRulePage[] = [];

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'pactlab-cre-directions-'));
    const run = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/generate.py'), out], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
    const dir = join(out, 'commercial-property', 'USD');
    for (const target of PACKS.COMMERCIAL_PROPERTY.importTargets) {
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
    for (const rule of COMMERCIAL_PROPERTY_RULES) {
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
      'cre-rent-roll-verification:rent-overstated',
      'cre-expiry-cliff:expiry-cliff',
      'cre-recovery-shortfall:recovery-shortfall',
      'cre-condition-capex-gap:condition-item-unscheduled',
      'cre-obligations:landlord-obligations',
      'cre-below-market-anchor:below-market-anchor',
      'cre-pnl-trend:trend',
    ]) {
      expect(seen, outcome).toContain(outcome);
    }
  });

  it('the rules draft exactly the README’s findings from the demo data', () => {
    const titles = COMMERCIAL_PROPERTY_RULES.flatMap((rule) => rule.detect({ evidence, pages: rule.readsDocuments ? pages : [] }).map((proposal) => proposal.title));
    const readme = readFileSync(join(out, 'commercial-property', 'USD', 'README.md'), 'utf8');
    const listed = [...(readme.split('You should see exactly these')[1]?.split('\n3. ')[0] ?? '').matchAll(/^ {3}\d+\. \*\*(.+?)\*\* — /gm)].map((match) => match[1]);
    expect(titles.sort()).toEqual(listed.sort());
  });
});

describe('the recovery shortfall is a trend a single year misses (T-165)', () => {
  it('drafts nothing from one statement year, and the trend from three', () => {
    const out = mkdtempSync(join(tmpdir(), 'pactlab-cre-single-year-'));
    try {
      const run = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/generate.py'), out], { encoding: 'utf8' });
      if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
      const dir = join(out, 'commercial-property', 'USD');
      const pages: PackRulePage[] = readFileSync(join(dir, 'documents', '03-leases.md'), 'utf8')
        .split(/^---page---$/m)
        .map((text, index) => ({ documentId: '0190f000-0000-7000-8000-000000000003', pageNumber: index + 1, text }));
      const [header = '', ...lines] = readFileSync(join(dir, 'pnl.csv'), 'utf8').trim().split('\n');
      const years = header.split(',').slice(1).map((year) => year.replace(/^FY/, ''));
      const pnl = (only: readonly string[]): PackRuleEvidence[] =>
        lines.flatMap((line) => {
          const [account = '', ...amounts] = line.split(',');
          return amounts.flatMap((amount, index) =>
            only.includes(years[index] ?? '') ? [{ id: `pnl:${account}:${years[index]}`, evidenceType: PNL_LINE_EVIDENCE_TYPE, sourceRecordId: `${account}|${years[index]}`, canonical: { account, month: years[index] ?? '', amount, line_kind: /revenue/i.test(account) ? 'REVENUE' : 'OPEX' } }] : [],
          );
        });
      const shortfall = COMMERCIAL_PROPERTY_RULES.find((rule) => rule.id === 'cre-recovery-shortfall');
      expect(shortfall?.detect({ evidence: pnl(['2025']), pages })).toEqual([]);
      expect(shortfall?.detect({ evidence: pnl(years), pages }).map((proposal) => proposal.title)).toEqual(['NNN recoveries short of the leases every year, 2023–2025']);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
