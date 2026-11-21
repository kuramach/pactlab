import { describe, expect, it } from 'vitest';
import { tableAtHeaderRow, type CsvTable } from '../evidence/csv';
import {
  ASSIST_CONFIDENCE,
  checkProposal,
  detectHeaderRow,
  layoutProblems,
  PERIOD_COLUMN,
  pnlTieOut,
  reshapeTable,
  VALUE_COLUMN,
  type MappingProposal,
} from './ai-mapping';
import { applyMapping, statementCheck, type ImportMapping } from './mapping';
import { suggestFields } from './suggest';
import { FINANCIAL_PNL, MULTIFAMILY_RENT_ROLL, MULTIFAMILY_T12 } from './targets';

const records = (rows: string[][]) => rows.map((cells) => ({ cells, text: cells.join(',') }));

/** A messy, synthetic rent roll: two title rows, a blank row, then the header. */
const RENT_ROLL = [
  ['Maple Court Apartments', '', '', '', '', '', ''],
  ['Rent roll as of 2026-10-31', '', '', '', '', '', ''],
  ['', '', '', '', '', '', ''],
  ['Unit #', 'Bldg', 'Occupancy', 'Lease Exp.', 'Mo. Rent (Current)', 'Market Rent', 'Contract Rent'],
  ['101', 'A', 'occupied', '2027-03-31', '1850.00', '1900.00', '1850.00'],
  ['102', 'A', 'vacant', '', '0', '1900.00', '0'],
];

/** A synthetic P&L: lines down, months across, with subtotals. */
const PNL = [
  ['Northwind Software LLC', '', '', ''],
  ['Income statement', '', '', ''],
  ['', 'Jan 2026', 'Feb 2026', 'Mar 2026'],
  ['Subscription revenue', '100000', '110000', '120000'],
  ['Services revenue', '20000', '20000', '25000'],
  ['Total revenue', '120000', '130000', '145000'],
  ['Hosting', '15000', '16000', '17000'],
  ['Gross profit', '105000', '114000', '128000'],
  ['Salaries and wages', '60000', '60000', '61000'],
  ['Net income', '45000', '54000', '67000'],
];

const PNL_PERIODS = [
  { column: 'Jan 2026', period: '2026-01' },
  { column: 'Feb 2026', period: '2026-02' },
  { column: 'Mar 2026', period: '2026-03' },
];

const PNL_KINDS = {
  'Subscription revenue': 'REVENUE',
  'Services revenue': 'REVENUE',
  'Total revenue': 'TOTAL_REVENUE',
  Hosting: 'COGS',
  'Gross profit': 'GROSS_PROFIT',
  'Salaries and wages': 'OPEX',
  'Net income': 'NET_INCOME',
} as const;

const pnlMapping = (overrides: Partial<ImportMapping> = {}): ImportMapping => ({
  target: 'FINANCIAL_PNL',
  fields: { account: { kind: 'column', column: 'Column A' }, month: { kind: 'column', column: PERIOD_COLUMN }, amount: { kind: 'column', column: VALUE_COLUMN } },
  dateFormat: 'YYYY-MM-DD',
  numberFormat: 'DOT_DECIMAL',
  amountUnit: 'MAJOR',
  negateAmounts: false,
  layout: { kind: 'PERIOD_COLUMNS', periods: PNL_PERIODS },
  lineKinds: PNL_KINDS,
  ...overrides,
});

describe('reading a real-world sheet', () => {
  it('finds the header below title rows and blank rows', () => {
    expect(detectHeaderRow(RENT_ROLL.filter((row) => row.some((cell) => cell !== '')))).toBe(3);
    expect(detectHeaderRow([['unit', 'building'], ['101', 'A']])).toBe(1);
  });

  it('a P&L header with an empty first cell still reads, the label column named by its letter', () => {
    const table = tableAtHeaderRow(records(PNL), 3);
    expect(table.header).toEqual(['Column A', 'Jan 2026', 'Feb 2026', 'Mar 2026']);
    expect(table.rows).toHaveLength(7);
  });
});

describe('layouts', () => {
  it('lines down, months across: one record per line per month', () => {
    const table = reshapeTable(tableAtHeaderRow(records(PNL), 3), { kind: 'PERIOD_COLUMNS', periods: PNL_PERIODS });
    expect(table.header).toEqual(['Column A', PERIOD_COLUMN, VALUE_COLUMN]);
    expect(table.rows[0]?.cells).toEqual(['Subscription revenue', '2026-01', '100000']);
    expect(table.rows).toHaveLength(21);
  });

  it('measures down, months across (a T-12): each month becomes a row', () => {
    const t12 = tableAtHeaderRow(
      records([
        ['Line', 'Oct 2026', 'Nov 2026'],
        ['Rental income', '90000', '91000'],
        ['Operating expenses', '40000', '41000'],
        ['NOI', '50000', '50000'],
      ]),
      1,
    );
    const layout = { kind: 'MONTHS_ACROSS', labelColumn: 'Line', periods: [{ column: 'Oct 2026', period: '2026-10' }, { column: 'Nov 2026', period: '2026-11' }] } as const;
    expect(layoutProblems(MULTIFAMILY_T12, t12.header, layout)).toEqual([]);
    const table = reshapeTable(t12, layout);
    expect(table.header).toEqual([PERIOD_COLUMN, 'Rental income', 'Operating expenses', 'NOI']);
    expect(table.rows.map((row) => row.cells)).toEqual([
      ['2026-10', '90000', '40000', '50000'],
      ['2026-11', '91000', '41000', '50000'],
    ]);
    const result = applyMapping(
      t12,
      {
        target: 'MULTIFAMILY_T12',
        fields: {
          month: { kind: 'column', column: PERIOD_COLUMN },
          rental_income: { kind: 'column', column: 'Rental income' },
          operating_expenses: { kind: 'column', column: 'Operating expenses' },
          net_operating_income: { kind: 'column', column: 'NOI' },
        },
        dateFormat: 'YYYY-MM-DD',
        numberFormat: 'DOT_DECIMAL',
        amountUnit: 'MAJOR',
        negateAmounts: false,
        layout,
      },
      'upload:t12',
    );
    expect(result.issues).toEqual([]);
    expect(result.rows.map((row) => row.canonical['net_operating_income'])).toEqual(['50000', '50000']);
  });

  it('refuses a month column the file does not have, or a month that is not YYYY-MM', () => {
    const header = ['Column A', 'Jan 2026'];
    expect(layoutProblems(FINANCIAL_PNL, header, { kind: 'PERIOD_COLUMNS', periods: [{ column: 'Dec 2025', period: '2025-12' }] })).toEqual(['Month column "Dec 2025" is not in the file']);
    expect(layoutProblems(FINANCIAL_PNL, header, { kind: 'PERIOD_COLUMNS', periods: [{ column: 'Jan 2026', period: 'January' }] })).toEqual(['"Jan 2026": the month must be YYYY-MM']);
    expect(layoutProblems(MULTIFAMILY_RENT_ROLL, header, { kind: 'PERIOD_COLUMNS', periods: [{ column: 'Jan 2026', period: '2026-01' }] })).toContain('Rent roll has no month, so months across cannot be read');
  });
});

describe('a P&L', () => {
  const table = tableAtHeaderRow(records(PNL), 3);

  it('imports lines, never subtotals, each with its kind', () => {
    const result = applyMapping(table, pnlMapping(), 'upload:pnl');
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(12);
    expect(result.rows[0]?.canonical).toMatchObject({ account: 'Subscription revenue', month: '2026-01', amount: '100000', line_kind: 'REVENUE' });
    expect(result.rows.some((row) => row.canonical['account'] === 'Total revenue')).toBe(false);
  });

  it('every subtotal ties out to its lines (expenses written positive)', () => {
    expect(statementCheck(table, pnlMapping())).toEqual({ unclassified: [], gaps: [] });
  });

  it('a subtotal that does not add up is shown with what the lines say', () => {
    const wrong = PNL.map((row) => (row[0] === 'Total revenue' ? ['Total revenue', '120000', '135000', '145000'] : row));
    expect(statementCheck(tableAtHeaderRow(records(wrong), 3), pnlMapping()).gaps).toEqual([{ account: 'Total revenue', month: '2026-02', kind: 'TOTAL_REVENUE', stated: '135000', computed: '130000' }]);
  });

  it('expenses written negative tie out too', () => {
    expect(
      pnlTieOut([
        { account: 'Revenue', month: '2026-01', amount: '100', kind: 'REVENUE' },
        { account: 'COGS', month: '2026-01', amount: '-40', kind: 'COGS' },
        { account: 'Gross profit', month: '2026-01', amount: '60', kind: 'GROSS_PROFIT' },
      ]),
    ).toEqual([]);
  });

  it('an account with no kind is named, and not imported', () => {
    const { 'Hosting': _hosting, ...rest } = PNL_KINDS;
    const mapping = pnlMapping({ lineKinds: rest });
    expect(statementCheck(table, mapping).unclassified).toEqual(['Hosting']);
    expect(applyMapping(table, mapping, 'upload:pnl').issues.map((issue) => issue.detail)).toContain('"Hosting" has no line kind');
  });
});

describe('checking the assistant’s proposal', () => {
  const table = tableAtHeaderRow(records(RENT_ROLL), 3);
  const preview = RENT_ROLL.filter((row) => row.some((cell) => cell !== ''));
  const pick = (field: string, column: string | null, confidence: number, evidence = column ?? '') => ({ field, column, confidence, reason: `Header "${column}"`, evidence });
  const proposal = (overrides: Partial<MappingProposal> = {}): MappingProposal => ({
    headerRow: 3,
    layout: { kind: 'ROWS' },
    fields: [
      pick('unit', 'Unit #', 0.98),
      pick('building', 'Bldg', 0.95),
      pick('status', 'Occupancy', 0.93),
      pick('lease_end', 'Lease Exp.', 0.92),
      pick('in_place_rent', 'Mo. Rent (Current)', 0.6),
      pick('market_rent', 'Market Rent', 0.97),
    ],
    lineKinds: [],
    questions: [{ field: 'in_place_rent', question: 'Is the tenant’s current rent "Mo. Rent (Current)" or "Contract Rent"?', options: ['Mo. Rent (Current)', 'Contract Rent'] }],
    ...overrides,
  });
  const check = (input: MappingProposal) =>
    checkProposal({ definition: MULTIFAMILY_RENT_ROLL, header: table.header, rawHeader: table.header, preview, proposal: input, byName: suggestFields(MULTIFAMILY_RENT_ROLL, table.header) });

  it('fills in what it is sure of and asks about the rest', () => {
    const assisted = check(proposal());
    expect(assisted.fields['unit']).toEqual({ kind: 'column', column: 'Unit #' });
    expect(assisted.picks['unit']).toMatchObject({ by: 'NAME' });
    expect(assisted.fields['building']).toEqual({ kind: 'column', column: 'Bldg' });
    expect(assisted.picks['building']).toMatchObject({ by: 'AI', confidence: 0.95 });
    expect(assisted.fields['in_place_rent']).toEqual({ kind: 'none' });
    expect(assisted.questions).toEqual([
      { field: 'in_place_rent', question: 'Is the tenant’s current rent "Mo. Rent (Current)" or "Contract Rent"?', options: ['Mo. Rent (Current)', 'Contract Rent'] },
    ]);
    expect(ASSIST_CONFIDENCE).toBeGreaterThan(0.6);
  });

  it('a name match wins over the assistant', () => {
    const assisted = check(proposal({ fields: [pick('market_rent', 'Contract Rent', 0.99)] }));
    expect(assisted.fields['market_rent']).toEqual({ kind: 'column', column: 'Market Rent' });
    expect(assisted.picks['market_rent']).toMatchObject({ by: 'NAME' });
  });

  it('drops a column the file does not have, and evidence that is not in the file', () => {
    const assisted = check(proposal({ fields: [pick('status', 'Apartment', 0.99), pick('building', 'Bldg', 0.99, 'Building B7')] }));
    expect(assisted.fields['status']).toEqual({ kind: 'none' });
    expect(assisted.fields['building']).toEqual({ kind: 'none' });
    expect(assisted.questions.map((question) => question.field)).toEqual(expect.arrayContaining(['status', 'building']));
  });

  it('one column feeds one field', () => {
    const assisted = check(proposal({ fields: [pick('building', 'Bldg', 0.99), pick('status', 'Bldg', 0.99)] }));
    expect(assisted.fields['status']).toEqual({ kind: 'none' });
  });

  it('an invalid layout falls back to rows', () => {
    const assisted = check(proposal({ layout: { kind: 'PERIOD_COLUMNS', periods: [{ column: 'Jan 2026', period: '2026-01' }] } }));
    expect(assisted.layout).toEqual({ kind: 'ROWS' });
  });
});

it('the reshaped table keeps every row’s source text for citations', () => {
  const table: CsvTable = { header: ['Line', 'Jan'], rows: [{ cells: ['Revenue', '5'], text: 'Revenue,5' }] };
  expect(reshapeTable(table, { kind: 'PERIOD_COLUMNS', periods: [{ column: 'Jan', period: '2026-01' }] }).rows[0]?.text).toBe('Revenue,5');
});
