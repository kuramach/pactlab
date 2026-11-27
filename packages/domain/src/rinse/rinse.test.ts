import { describe, expect, it } from 'vitest';
import { PACKS } from '../packs/registry';
import {
  auditConversion,
  findDuplicates,
  HAND_ENTRY_FORMS,
  inspectFile,
  parseAmount,
  readDocument,
  renderHandEntry,
  RINSE_CHECK_CODES,
  RINSE_CHECK_SEVERITY,
  rinseGaps,
  rinseReadiness,
  fileChecks,
  unreadablePages,
  validateHandEntry,
  formsFor,
} from './index';

const bytes = (text: string) => new TextEncoder().encode(text);
const PDF = bytes('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

const STATEMENT = [
  'Harbour Lane Apartments LLC — income statement, FY2026 (synthetic)',
  'Statement date: 2026-09-30',
  'Rental income: USD 1,200,000',
  'Other income: USD 220,000',
  'Total revenue: USD 1,420,000',
].join('\n');

describe('file inspection', () => {
  it('reads what a file is from its bytes, not its name', () => {
    expect(inspectFile('a.pdf', PDF)).toEqual({ kind: 'PDF', route: 'CONVERT', corrupt: null });
    expect(inspectFile('a.pdf', bytes('%PDF-1.7 cut off'))).toMatchObject({ corrupt: 'TRUNCATED' });
    expect(inspectFile('a.pdf', bytes('not a pdf'))).toMatchObject({ corrupt: 'SIGNATURE_MISMATCH' });
    expect(inspectFile('a.docx', new Uint8Array(0))).toMatchObject({ corrupt: 'EMPTY' });
    expect(inspectFile('t12.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]))).toEqual({ kind: 'SPREADSHEET', route: 'GUIDED_IMPORT', corrupt: null });
    expect(inspectFile('old.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toMatchObject({ corrupt: 'LEGACY_FORMAT' });
    expect(inspectFile('scan.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toMatchObject({ kind: 'IMAGE', corrupt: null });
  });

  it('finds exact and near duplicates, keeping the first of each', () => {
    const text = 'This lease is made between the landlord and the tenant for the premises at Harbour Lane for five years';
    const matches = findDuplicates([
      { id: 'a', sha256: 'h1', text },
      { id: 'b', sha256: 'h1', text },
      { id: 'c', sha256: 'h2', text: `${text}.` },
      { id: 'd', sha256: 'h3', text: 'An entirely different board resolution about something else' },
    ]);
    expect(matches.map((match) => [match.id, match.of, match.kind])).toEqual([
      ['b', 'a', 'EXACT'],
      ['c', 'a', 'NEAR'],
    ]);
  });

  it('flags pages with no text layer', () => {
    expect(unreadablePages(['x', STATEMENT])).toEqual([1]);
  });
});

describe('the conversion audit', () => {
  it('reads figures and tables deterministically, and amounts exactly', () => {
    const reading = readDocument([STATEMENT]);
    expect(reading.figures.map((figure) => [figure.label, figure.value])).toContainEqual(['Total revenue', '1420000']);
    expect(reading.tables).toHaveLength(1);
    expect(reading.dates).toEqual(['2026-09-30']);
    expect(reading.parties).toContain('Harbour Lane Apartments LLC');
    expect(parseAmount('(1,234.50)')).toBe(parseAmount('-1234.5'));
  });

  it('a clean conversion matches every figure', () => {
    const audit = auditConversion(readDocument([STATEMENT]), readDocument([STATEMENT]));
    expect(audit.mismatches).toEqual([]);
    expect(audit.figuresMatched).toBe(audit.figuresCompared);
  });

  it('a scan that mis-reads a revenue total is a conversion mismatch, shown on both sides', () => {
    const misread = STATEMENT.replace('Total revenue: USD 1,420,000', 'Total revenue: USD 1,240,000');
    const audit = auditConversion(readDocument([STATEMENT]), readDocument([misread]));
    expect(audit.mismatches).toContainEqual({ kind: 'FIGURE', label: 'Total revenue', original: { value: '1420000', page: 1 }, converted: { value: '1240000', page: 1 } });
    expect(audit.sourceDiscrepancies).toEqual([]);
    const checks = fileChecks({ inspection: { kind: 'PDF', route: 'CONVERT', corrupt: null }, duplicateOf: null, unreadablePages: [], visionRead: true, online: true, classified: true, audit });
    expect(rinseReadiness(checks, []).ready).toBe(false);
  });

  it('an original that does not foot is a source discrepancy that travels, not a conversion error', () => {
    const notFooting = STATEMENT.replace('Other income: USD 220,000', 'Other income: USD 200,000');
    const audit = auditConversion(readDocument([notFooting]), readDocument([notFooting]));
    expect(audit.mismatches).toEqual([]);
    expect(audit.sourceDiscrepancies).toEqual([{ label: 'Total revenue', page: 1, stated: '1420000', computed: '1400000' }]);
    const checks = fileChecks({ inspection: { kind: 'PDF', route: 'CONVERT', corrupt: null }, duplicateOf: null, unreadablePages: [], visionRead: true, online: true, classified: true, audit });
    expect(checks.map((item) => [item.code, item.severity])).toEqual([['SOURCE_DISCREPANCY', 'WARNING']]);
    expect(rinseReadiness(checks, []).ready).toBe(true);
  });

  it('a dropped page is a mismatch', () => {
    const audit = auditConversion(readDocument([STATEMENT, 'Notes to the statement, page two of the original statement text.']), readDocument([STATEMENT]));
    expect(audit.mismatches.map((mismatch) => mismatch.kind)).toContain('PAGE_COUNT');
  });
});

describe('gaps and readiness', () => {
  const pack = PACKS.MULTIFAMILY;

  it('lists the pack’s expected documents, and a required one missing keeps the set from ready', () => {
    const gaps = rinseGaps(pack, [{ id: 'd1', category: 'MULTIFAMILY_RENT_ROLL', excluded: false, flagged: false, handEntry: null }], []);
    expect(gaps.find((gap) => gap.input === 'MULTIFAMILY_RENT_ROLL')?.state).toBe('PRESENT');
    expect(gaps.find((gap) => gap.input === 'MULTIFAMILY_OCCUPANCY')?.state).toBe('MISSING');
    expect(rinseReadiness([], gaps).ready).toBe(false);
  });

  it('closes a gap by hand entry, or by a note; both travel', () => {
    const required = rinseGaps(pack, [], []).filter((gap) => gap.need === 'REQUIRED').map((gap) => gap.input);
    const gaps = rinseGaps(
      pack,
      [{ id: 'h1', category: null, excluded: false, flagged: false, handEntry: 'VACANCY_SCHEDULE' }],
      required.filter((input) => input !== 'MULTIFAMILY_OCCUPANCY').map((input) => ({ input, kind: 'NOTED' as const, note: 'To follow from the manager.' })),
    );
    expect(gaps.find((gap) => gap.input === 'MULTIFAMILY_OCCUPANCY')?.state).toBe('HAND_SOURCED');
    expect(rinseReadiness([], gaps).ready).toBe(true);
  });

  it('every check code has a severity, and errors are the ones that block', () => {
    expect(Object.keys(RINSE_CHECK_SEVERITY).sort()).toEqual([...RINSE_CHECK_CODES].sort());
    expect(RINSE_CHECK_SEVERITY.CONVERSION_MISMATCH).toBe('ERROR');
    expect(RINSE_CHECK_SEVERITY.SOURCE_DISCREPANCY).toBe('WARNING');
  });
});

describe('hand-sourced entries', () => {
  const enterer = { userId: '0190-user', name: 'Dana Whitlow', organization: 'Harbour Lane Apartments LLC (synthetic)' };

  it('checks entered values against the form', () => {
    const { problems } = validateHandEntry('KEY_LEASE_TERMS', [{ premises: 'Unit 4', startsOn: 'next spring', annualRent: 'a lot' }]);
    expect(problems.map((problem) => problem.problem)).toEqual(expect.arrayContaining(['REQUIRED', 'NOT_A_DATE', 'NOT_AN_AMOUNT']));
  });

  it('generates a stamped canonical document that reads back to the values entered', () => {
    const { rows, problems } = validateHandEntry('VACANCY_SCHEDULE', [{ period: '2026-09', unitType: 'All', units: '120', occupiedUnits: '106', averageRent: '1,450.00' }]);
    expect(problems).toEqual([]);
    const lines = renderHandEntry('VACANCY_SCHEDULE', rows, enterer, '2026-11-27T10:00:00Z', 'USD');
    expect(lines[0]).toBe('Hand-sourced — entered by Dana Whitlow, Harbour Lane Apartments LLC (synthetic) on 2026-11-27');
    const reading = readDocument([lines.join('\n')]);
    expect(reading.figures.find((figure) => figure.label === 'Average in-place rent')?.value).toBe('1450');
    expect(formsFor('MULTIFAMILY_OCCUPANCY').map((form) => form.id)).toEqual(['VACANCY_SCHEDULE', 'ATTESTED_NOTE']);
    expect(HAND_ENTRY_FORMS.ATTESTED_NOTE.covers).toEqual([]);
  });
});
