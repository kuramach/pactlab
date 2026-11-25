import { describe, expect, it } from 'vitest';
import { checkProposal, type MappingProposal } from './ai-mapping';
import { normalizeGuidance, renderGuidance, subtotalConflicts, type ImportGuidance } from './guidance';
import { FINANCIAL_PNL } from './targets';

describe('normalizeGuidance (T-152)', () => {
  it('is null when nothing is said, and squashes text', () => {
    expect(normalizeGuidance(null)).toBeNull();
    expect(normalizeGuidance({ instructions: '   ', annotations: [{ fromRow: 1, toRow: 1, note: '  ' }] })).toBeNull();
    expect(normalizeGuidance({ instructions: ' row 1   is a\n title ' })).toEqual({ instructions: 'row 1 is a title', annotations: [] });
  });

  it('orders and clamps ranges, merges the same range, drops rows outside the grid', () => {
    const guidance = normalizeGuidance({
      instructions: '',
      annotations: [
        { fromRow: 40, toRow: 50, note: 'beyond the grid' },
        { fromRow: 3, toRow: 1, note: 'title rows' },
        { fromRow: 1, toRow: 3, note: 'skip them' },
        { fromRow: 28, toRow: 45, note: 'tail' },
      ],
    });
    expect(guidance?.annotations).toEqual([
      { fromRow: 1, toRow: 3, note: 'title rows; skip them' },
      { fromRow: 28, toRow: 30, note: 'tail' },
    ]);
  });

  it('renders one line per instruction for the model', () => {
    const guidance = normalizeGuidance({ instructions: 'Amounts are annual', annotations: [{ fromRow: 14, toRow: 14, note: 'subtotal' }, { fromRow: 1, toRow: 3, note: 'title rows' }] });
    expect(renderGuidance(guidance)).toBe('About the file: Amounts are annual\nrows 1–3: title rows\nrow 14: subtotal');
    expect(renderGuidance(null)).toBe('');
  });
});

const GRID = [
  ['Unit', 'Rent'],
  ['101', '1000'],
  ['102', '500'],
  ['Total', '1500'],
];

describe('subtotalConflicts', () => {
  const say = (note: string, row: number): ImportGuidance => ({ instructions: '', annotations: [{ fromRow: row, toRow: row, note }] });

  it('a subtotal that adds up raises nothing', () => {
    expect(subtotalConflicts(GRID, 1, say('row 4 is a subtotal, not data', 4))).toEqual([]);
  });

  it('a data row called a subtotal is a question, not a silent override', () => {
    const conflicts = subtotalConflicts(GRID, 1, say('this is a subtotal', 3));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.question).toContain('row 3');
  });

  it('exact money: a cent off ties, more does not', () => {
    expect(subtotalConflicts([...GRID.slice(0, 3), ['Total', '1500.01']], 1, say('subtotal', 4))).toEqual([]);
    expect(subtotalConflicts([...GRID.slice(0, 3), ['Total', '1502']], 1, say('subtotal', 4))).toHaveLength(1);
  });

  it('rows past the grid, and notes that are not about totals, are left alone', () => {
    expect(subtotalConflicts(GRID, 1, say('subtotal', 20))).toEqual([]);
    expect(subtotalConflicts(GRID, 1, say('column B is the rent', 3))).toEqual([]);
  });
});

describe('checkProposal with guidance', () => {
  const proposal: MappingProposal = {
    headerRow: 3,
    layout: { kind: 'ROWS' },
    fields: [{ field: 'account', column: 'Line', confidence: 0.95, reason: 'You said so', evidence: 'Line', guided: true }],
    lineKinds: [],
    questions: [],
  };
  const preview = [['Co'], ['Statement'], ['Line', 'Amount'], ['Sales', '100'], ['More', '50'], ['Subtotal', '999']];
  const check = (guidance: ImportGuidance | null) =>
    checkProposal({ definition: FINANCIAL_PNL, header: ['Line', 'Amount'], rawHeader: ['Line', 'Amount'], preview, proposal, byName: {}, guidance });

  it('marks a pick the person decided as GUIDED, and only when guidance exists', () => {
    expect(check({ instructions: 'column A is the account', annotations: [] }).picks['account']?.by).toBe('GUIDED');
    expect(check(null).picks['account']?.by).toBe('AI');
  });

  it('a wrong subtotal note asks, and the guidance is carried to the screen', () => {
    const guidance = { instructions: '', annotations: [{ fromRow: 6, toRow: 6, note: 'subtotal' }] };
    const assist = check(guidance);
    expect(assist.questions.find((question) => question.field === null)?.question).toContain('row 6');
    expect(assist.guidance).toEqual(guidance);
  });
});
