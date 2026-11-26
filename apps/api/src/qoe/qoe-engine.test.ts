import { pnlPeriods, type PnlLineInput } from '@pactlab/calculations';
import { describe, expect, it } from 'vitest';
import { adjustedEbitdaSchedule, workingCapitalAnalysis, type AddBackInput, type WorkingCapitalInput } from './qoe-engine';

const citation = { documentId: 'doc', pageNumber: 1, quote: 'q' };
const cited = (key: string) => ({ entryKey: key, version: 1, citation });
const addBack = (key: string, overrides: Partial<AddBackInput>): AddBackInput => ({
  ...cited(key),
  period: 'FY2025',
  category: 'NON_RECURRING',
  label: key,
  claimed: '100000',
  currency: 'USD',
  sellerRationale: null,
  status: 'UNVERIFIED',
  verified: null,
  verificationCitation: null,
  recurrence: 'ONE_OFF',
  inclusion: null,
  decisionReason: null,
  findingId: null,
  ...overrides,
});

describe('adjusted-EBITDA schedule (qoe-2)', () => {
  const base = {
    reported: [{ ...cited('r'), period: 'FY2025', label: 'Reported EBITDA', amount: '1200000', currency: 'USD' }],
    adjustments: [
      { ...cited('owner'), period: 'FY2025', category: 'OWNER_COMPENSATION' as const, label: 'Owner pay to market', amount: '150000', currency: 'USD', rationale: null, findingId: null },
      { ...cited('rent'), period: 'FY2025', category: 'RENT_NORMALIZATION' as const, label: 'Related-party rent to market', amount: '-60000.50', currency: 'USD', rationale: null, findingId: null },
    ],
  };

  it('keeps unverified add-backs out, counts partially verified ones at the verified figure, and never merges the seller’s claim', () => {
    const [schedule] = adjustedEbitdaSchedule({
      ...base,
      addBacks: [
        addBack('legal', { status: 'VERIFIED', claimed: '80000', verificationCitation: citation }),
        addBack('consulting', { status: 'PARTIALLY_VERIFIED', claimed: '50000', verified: '20000', verificationCitation: citation }),
        addBack('bonus', { status: 'UNVERIFIED', claimed: '100000' }),
      ],
    });
    expect(schedule!.totals).toEqual({ adjustments: '89999.50', addBacksCounted: '100000.00', addBacksClaimed: '230000.00', addBacksExcluded: '130000.00' });
    expect(schedule!.adjustedEbitda).toBe('1389999.50');
    expect(schedule!.sellerAdjustedEbitda).toBe('1430000.00');
    expect(schedule!.addBacks.find((row) => row.entryKey === 'bonus')).toMatchObject({ counts: false, counted: '0.00', treatment: 'Excluded: unverified (default)' });
    expect(schedule!.flags.join(' ')).toContain('1 unverified add-back: 0 included by reviewer decision, 1 excluded.');
  });

  it('an explicit reviewer inclusion brings an unverified add-back in at its claimed amount', () => {
    const [schedule] = adjustedEbitdaSchedule({ ...base, addBacks: [addBack('bonus', { inclusion: 'INCLUDE', decisionReason: 'Board minutes support it' })] });
    expect(schedule!.adjustedEbitda).toBe('1389999.50');
    expect(schedule!.addBacks[0]).toMatchObject({ counts: true, counted: '100000.00', treatment: 'Included by reviewer decision (unverified)' });
  });

  it('computes nothing without a reported figure', () => {
    const [schedule] = adjustedEbitdaSchedule({ reported: [], adjustments: base.adjustments, addBacks: [] });
    expect(schedule!.adjustedEbitda).toBeNull();
    expect(schedule!.flags[0]).toContain('No reported EBITDA');
  });
});

describe('the imported P&L in the schedule (qoe-2, T-149)', () => {
  let n = 0;
  const line = (period: string, kind: PnlLineInput['kind'], amount: string): PnlLineInput => ({ evidenceId: `ev-${n++}`, account: `${kind} ${n}`, period, amount, kind });
  const month = (period: string) => [line(period, 'REVENUE', '250000'), line(period, 'COGS', '-100000'), line(period, 'OPEX', '-50000')];
  const fy = pnlPeriods(Array.from({ length: 12 }, (_, index) => month(`2025-${String(index + 1).padStart(2, '0')}`)).flat());
  const filed = (amount: string) => [{ ...cited('r'), period: 'FY2025', label: 'Reported EBITDA', amount, currency: 'USD' }];

  it('reads each month from the imported lines, citing its rows, with no entry needed', () => {
    const schedule = adjustedEbitdaSchedule({ reported: [], adjustments: [], addBacks: [], pnl: fy, currency: 'USD' });
    expect(schedule).toHaveLength(12);
    expect(schedule[0]).toMatchObject({ period: '2025-01', currency: 'USD', reportedEbitda: { amount: '100000.00', source: 'IMPORTED_PNL' }, adjustedEbitda: '100000.00', conflict: null });
    expect(schedule[0]!.pnl).toMatchObject({ revenue: '250000.00', costOfRevenue: '100000.00', operatingExpenses: '50000.00' });
    expect(schedule[0]!.pnl!.sources.map((row) => row.evidenceId)).toHaveLength(3);
  });

  it('rolls a written year up from its twelve imported months and shows an agreeing filed figure beside it', () => {
    const schedule = adjustedEbitdaSchedule({ reported: filed('1200000.40'), adjustments: [], addBacks: [], pnl: fy });
    const year = schedule.find((period) => period.period === 'FY2025')!;
    expect(year.reportedEbitda).toEqual({ amount: '1200000.00', source: 'BOTH' });
    expect(year.pnl!.rolledUpFrom).toHaveLength(12);
    expect(year.pnl!.sources).toHaveLength(36);
    expect(year.adjustedEbitda).toBe('1200000.00');
    expect(schedule).toHaveLength(13);
  });

  it('never picks silently when the imported P&L and the filed statement disagree', () => {
    const year = adjustedEbitdaSchedule({ reported: filed('1350000'), adjustments: [{ ...cited('owner'), period: 'FY2025', category: 'OWNER_COMPENSATION', label: 'Owner pay', amount: '150000', currency: 'USD', rationale: null, findingId: null }], addBacks: [], pnl: fy }).find((period) => period.period === 'FY2025')!;
    expect(year.reportedEbitda).toBeNull();
    expect(year.adjustedEbitda).toBeNull();
    expect(year.sellerAdjustedEbitda).toBeNull();
    expect(year.conflict).toMatchObject({ imported: '1200000.00', filed: '1350000.00', difference: '-150000.00', filedEntry: { entryKey: 'r' } });
    expect(year.flags.join(' ')).toContain('disagree by -150000.00');
  });

  it('keeps a filed-only period as before', () => {
    const [period] = adjustedEbitdaSchedule({ reported: filed('900000'), adjustments: [], addBacks: [], pnl: [] });
    expect(period!.reportedEbitda).toEqual({ amount: '900000.00', source: 'FILED_STATEMENT' });
  });
});

describe('working-capital analysis', () => {
  const line = (periodEnd: string, component: WorkingCapitalInput['component'], amount: string): WorkingCapitalInput => ({ ...cited(`${periodEnd}-${component}`), periodEnd, component, label: component, amount, currency: 'USD' });
  const months = ['2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'];
  const receivables = ['300000', '360000', '420000', '330000'];
  const lines = months.flatMap((month, index) => [line(month, 'RECEIVABLES', receivables[index]!), line(month, 'INVENTORY', '50000'), line(month, 'PAYABLES', '120000'), line(month, 'DEFERRED_REVENUE', '40000')]);

  it('derives net working capital per date, its range, the drivers and the peg', () => {
    const analysis = workingCapitalAnalysis(lines);
    expect(analysis.periods.map((period) => period.netWorkingCapital)).toEqual(['190000.00', '250000.00', '310000.00', '220000.00']);
    expect(analysis.average).toBe('242500.00');
    expect(analysis.low).toEqual({ periodEnd: '2026-06-30', amount: '190000.00' });
    expect(analysis.high).toEqual({ periodEnd: '2026-08-31', amount: '310000.00' });
    expect(analysis.drivers[0]).toMatchObject({ component: 'RECEIVABLES', range: '120000.00', firstToLast: '30000.00' });
    expect(analysis.peg).toMatchObject({ amount: '242500.00', periods: months });
    expect(analysis.peg!.derivation).toContain('USD 970000.00 ÷ 4 = USD 242500.00');
  });

  it('averages only the trailing twelve dates, and proposes no peg on fewer than three', () => {
    expect(workingCapitalAnalysis(lines.filter((entry) => entry.periodEnd < '2026-08-01')).peg).toBeNull();
    expect(workingCapitalAnalysis(lines.filter((entry) => entry.periodEnd < '2026-08-01')).pegUnavailable).toContain('at least 3');
    const year = Array.from({ length: 14 }, (_, index) => line(`2025-${String((index % 12) + 1).padStart(2, '0')}-${index < 12 ? '28' : '27'}`.replace(/^2025-(\d\d)-27$/, '2027-$1-28'), 'RECEIVABLES', String(1000 * (index + 1))));
    expect(workingCapitalAnalysis(year).peg!.periods).toHaveLength(12);
  });
});
