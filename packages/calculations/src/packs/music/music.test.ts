import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { addYears, catalogRows, incomeModel, statedHoldYears, statementGaps, terminationExposure, terminationWindow, type MusicGrant } from './catalog';
import { musicMetrics } from './metrics';
import {
  MUSIC_CHAIN_OF_TITLE_GAP,
  MUSIC_INCOME_CONCENTRATION,
  MUSIC_RECOUPMENT_MISMATCH,
  MUSIC_ROYALTY_LEAKAGE,
  MUSIC_SPLIT_MISMATCH,
  MUSIC_STATEMENT_GAP,
  MUSIC_TERMINATION_EXPOSURE,
  MUSIC_UNDISCLOSED_ENCUMBRANCE,
  MUSIC_VERIFIED_GROWTH,
} from './rules';

let next = 0;
const row = (evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id: `e-${(next += 1)}`, evidenceType, sourceRecordId: Object.values(canonical)[0] ?? '', canonical });
const work = (id: string, overrides: Record<string, string> = {}) => row('music.work', { work_id: id, title: `Song ${id}`, work_type: 'composition', pro: 'ASCAP', release_year: '2012', us_work: 'yes', ...overrides });
const line = (workId: string, periodEnd: string, amount: string, source = 'performance', payer = 'ASCAP') => row('music.royalty_line', { line_id: `${workId}-${periodEnd}-${source}`, period_end: periodEnd, work_id: workId, income_source: source, payer, amount });
const grant = (workId: string, type: string, executedOn: string, extra: Record<string, string> = {}) => row('music.grant', { grant_id: `${workId}-${type}`, work_id: workId, grant_type: type, executed_on: executedOn, ...extra });
const split = (workId: string, writer: string, share: string, source = 'split_sheet') => row('music.split', { split_id: `${workId}-${writer}-${source}`, work_id: workId, writer_ref: writer, share_pct: share, source });
const PERIODS = ['2024-12-31', '2025-06-30', '2025-12-31', '2026-06-30'];
const titled = (id: string) => [grant(id, 'registration', '1990-01-01'), grant(id, 'assignment', '2015-03-01')];

describe('music catalog model (T-140)', () => {
  it('adds years on dates and clamps 29 February', () => {
    expect(addYears('2026-06-30', -1)).toBe('2025-06-30');
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(addYears('1990-05-01', 35)).toBe('2025-05-01');
  });

  it('splits trailing and prior-year income, by source and age band, and never adds growth to the decay-adjusted figure', () => {
    const evidence = [
      work('W1', { release_year: '2025' }),
      work('W2', { release_year: '2000' }),
      ...PERIODS.map((period, index) => line('W1', period, String(100 + index * 50))), // growing: prior 250, trailing 450
      ...PERIODS.map((period, index) => line('W2', period, String(200 - index * 20), 'mechanical')), // declining: prior 380, trailing 300
    ];
    const income = incomeModel(catalogRows(evidence));
    expect(income.latestPeriodEnd).toBe('2026-06-30');
    expect(income.trailing.toFixed(2)).toBe('750.00');
    expect(income.prior.toFixed(2)).toBe('630.00');
    expect(income.bySource.get('mechanical')?.toFixed(0)).toBe('300');
    const bands = Object.fromEntries(income.bands.map((band) => [band.key, band]));
    expect(bands['0-2']?.decayAdjusted.toFixed(2)).toBe('450.00');
    // 300 ÷ 380 − 1 = −21.05…%: trailing 300 × (1 − 0.2105…) = 236.84
    expect(bands['21+']?.decayAdjusted.toFixed(2)).toBe('236.84');
    expect(income.decayAdjusted.toFixed(2)).toBe('686.84');
  });

  it('computes §203 and §304(c) windows and leaves out what the statute does not reach', () => {
    const base: MusicGrant = { id: 'g', workId: 'W', type: 'assignment', executedOn: '1990-05-01', publicationDate: null, copyrightSecuredOn: null, grantor: null, reference: null };
    expect(terminationWindow(base, true)).toEqual({ statute: '§203', opens: '2025-05-01', closes: '2030-05-01' });
    expect(terminationWindow({ ...base, publicationDate: '1992-01-01' }, true)).toEqual({ statute: '§203', opens: '2027-01-01', closes: '2032-01-01' });
    expect(terminationWindow({ ...base, publicationDate: '1999-01-01' }, true)?.opens).toBe('2030-05-01');
    expect(terminationWindow({ ...base, executedOn: '1965-01-01', copyrightSecuredOn: '1965-01-01' }, true)).toEqual({ statute: '§304(c)', opens: '2021-01-01', closes: '2026-01-01' });
    expect(terminationWindow({ ...base, type: 'work_for_hire' }, true)).toBeNull();
    expect(terminationWindow({ ...base, type: 'administration' }, true)).toBeNull();
    expect(terminationWindow(base, false)).toBeNull();
    expect(terminationWindow({ ...base, executedOn: '1970-01-01' }, true)).toBeNull();
  });

  it('quantifies the income behind grants terminable inside the hold, at the grantor’s split share', () => {
    const evidence = [
      work('W1'),
      work('W2'),
      work('W3', { us_work: 'no' }),
      ...['W1', 'W2', 'W3'].flatMap((id) => PERIODS.map((period) => line(id, period, '100'))),
      grant('W1', 'assignment', '1995-01-01', { grantor_ref: 'WR-1' }), // opens 2030: inside a 10-year hold
      split('W1', 'WR-1', '60'),
      split('W1', 'WR-2', '40'),
      grant('W2', 'assignment', '2010-01-01'), // opens 2045: outside
      grant('W3', 'assignment', '1990-01-01'), // not a US work
    ];
    const rows = catalogRows(evidence);
    const exposure = terminationExposure(rows, incomeModel(rows), 10);
    expect(exposure.holdEnds).toBe('2036-06-30');
    expect(exposure.grants.map((exposed) => [exposed.workId, exposed.share.toFixed(2), exposed.exposedIncome.toFixed(2)])).toEqual([['W1', '0.60', '120.00']]);
    expect(exposure.share?.toFixed(4)).toBe('0.2000');
    expect(terminationExposure(rows, incomeModel(rows), 3).grants).toEqual([]);
  });

  it('finds statement gaps between a payer’s own statements and the stated hold period', () => {
    const rows = catalogRows([line('W1', '2025-06-30', '1', 'performance', 'BMI'), line('W1', '2026-06-30', '1', 'performance', 'BMI'), line('W2', '2025-12-31', '1', 'performance', 'ASCAP')]);
    expect(statementGaps(rows)).toEqual([{ payer: 'BMI', missing: ['2025-12-31'], lineIds: expect.any(Array) }]);
    expect(statedHoldYears([{ text: 'Our intended hold period of 7\nyears.' }])).toEqual({ years: 7, stated: true });
    expect(statedHoldYears([{ text: 'nothing' }])).toEqual({ years: 10, stated: false });
  });

  it('reports the income model as pack metrics', () => {
    const report = musicMetrics({ currency: 'USD', evidence: [work('W1'), ...PERIODS.map((period) => line('W1', period, '100'))] });
    expect(report).toMatchObject({ calculator: 'music-royalties', version: 'music-royalties-1', currency: 'USD' });
    const byKey = Object.fromEntries(report.metrics.map((metric) => [metric.key, metric.value]));
    expect(byKey).toMatchObject({ works: '1', trailing_income: '200.00', prior_income: '200.00', income_change: '0.0000', decay_adjusted_income: '200.00', income_performance: '200.00', top_work_share: '1.0000', statement_periods: '4' });
    expect(musicMetrics({ currency: 'USD', evidence: [] }).metrics.find((metric) => metric.key === 'trailing_income')?.unavailableReason).toMatch(/royalty statements/);
  });
});

describe('music rules (T-140)', () => {
  it('chain-of-title gap: an earning work without an assignment', () => {
    const evidence = [work('W1', { title: 'Hit' }), work('W2'), ...['W1', 'W2'].flatMap((id) => PERIODS.map((period) => line(id, period, '100'))), grant('W1', 'registration', '1999-01-01'), ...titled('W2')];
    const proposals = MUSIC_CHAIN_OF_TITLE_GAP.detect({ evidence, pages: [] });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ key: 'W1', title: 'Chain-of-title gap: Hit', direction: -1 });
    expect(proposals[0]?.description).toMatch(/the chain of title holds no assignment to the seller or work-for-hire agreement for it/);
  });

  it('split mismatch: shares over 100%, and a statement paying differently from the sheet', () => {
    const evidence = [work('W1'), split('W1', 'WR-1', '55'), split('W1', 'WR-2', '50'), work('W2'), split('W2', 'WR-3', '100'), split('W2', 'WR-3', '90', 'statement'), work('W3'), split('W3', 'WR-4', '50'), split('W3', 'WR-5', '50')];
    const proposals = MUSIC_SPLIT_MISMATCH.detect({ evidence, pages: [] });
    expect(proposals.map((proposal) => proposal.key)).toEqual(['W1', 'W2']);
    expect(proposals[0]?.description).toMatch(/total 105%, not 100%/);
    expect(proposals[1]?.description).toMatch(/pays WR-3 90% against 100% on the split sheet/);
  });

  it('termination exposure: drafted at 10% of trailing income or more, with the stated hold', () => {
    const evidence = [work('W1'), work('W2'), ...['W1', 'W2'].flatMap((id) => PERIODS.map((period) => line(id, period, '100'))), grant('W1', 'assignment', '1995-01-01'), grant('W2', 'assignment', '2015-01-01')];
    const [finding] = MUSIC_TERMINATION_EXPOSURE.detect({ evidence, pages: [] });
    expect(finding).toMatchObject({ direction: -1, title: 'Termination exposure inside the hold period' });
    expect(finding?.description).toMatch(/^Grants behind 50\.0% of trailing income \(200 of 400 a year, across 1 work\)/);
    expect(finding?.description).toMatch(/default hold/);
    expect(MUSIC_TERMINATION_EXPOSURE.detect({ evidence, pages: [{ documentId: 'd', pageNumber: 1, text: 'A hold period of 3 years.' }] })).toEqual([]);
  });

  it('concentration: the top work above 15%, the top writer above 25%', () => {
    const evidence = [work('W1'), work('W2'), ...PERIODS.map((period) => line('W1', period, '300')), ...PERIODS.map((period) => line('W2', period, '100')), split('W1', 'WR-1', '100'), split('W2', 'WR-2', '100')];
    const proposals = MUSIC_INCOME_CONCENTRATION.detect({ evidence, pages: [] });
    expect(proposals.map((proposal) => proposal.key)).toEqual(['work:W1', 'writer:WR-1']);
    expect(proposals[0]?.description).toMatch(/is 75\.0% of trailing income/);
  });

  it('recoupment mismatch: the ledger balance the summary does not disclose, priced off the price', () => {
    const ledger = { documentId: 'ledger', pageNumber: 2, text: 'Account statement. Unrecouped balance carried forward: USD 412,500. Next statement in March.' };
    const summary = { documentId: 'summary', pageNumber: 1, text: 'Catalog summary. There are no unrecouped advances outstanding against the catalog.' };
    const [finding] = MUSIC_RECOUPMENT_MISMATCH.detect({ evidence: [], pages: [ledger, summary] });
    expect(finding?.pricedRisk).toMatchObject({ type: 'PRICE_REDUCTION', currency: 'USD', low: '412500.00', high: '412500.00' });
    expect(finding?.quotes?.map((quote) => quote.documentId)).toEqual(['ledger', 'summary']);
    const disclosed = { ...summary, text: 'Unrecouped advances total USD 412,500 at closing.' };
    expect(MUSIC_RECOUPMENT_MISMATCH.detect({ evidence: [], pages: [ledger, disclosed] })).toEqual([]);
  });

  it('leakage: a registered work earning mechanicals but no performance income while its peers do', () => {
    const peers = ['P1', 'P2', 'P3'];
    const evidence = [work('W1'), ...peers.map((id) => work(id)), ...peers.map((id) => line(id, '2026-06-30', '50')), line('W1', '2026-06-30', '80', 'mechanical')];
    const [finding] = MUSIC_ROYALTY_LEAKAGE.detect({ evidence, pages: [] });
    expect(finding).toMatchObject({ direction: 0 });
    expect(finding?.description).toMatch(/^1 registered composition earned/);
    expect(MUSIC_ROYALTY_LEAKAGE.detect({ evidence: evidence.slice(0, 2), pages: [] })).toEqual([]);
  });

  it('undisclosed encumbrance: a UCC filing nobody else mentions, sized at what it secures', () => {
    const search = { documentId: 'ucc', pageNumber: 1, text: 'Search results. A UCC-1 financing statement was filed in favour of Northgate Credit Partners (synthetic), securing obligations up to USD 1,500,000 against the catalog.' };
    const summary = { documentId: 'summary', pageNumber: 1, text: 'The catalog is free of liens and encumbrances.' };
    const [finding] = MUSIC_UNDISCLOSED_ENCUMBRANCE.detect({ evidence: [], pages: [search, summary] });
    expect(finding).toMatchObject({ title: 'Undisclosed encumbrance: Northgate Credit Partners (synthetic)', pricedRisk: { type: 'INDEMNITY', low: '1500000.00' } });
    const disclosed = { ...summary, text: 'A lien in favour of Northgate Credit Partners (synthetic) is released at closing.' };
    expect(MUSIC_UNDISCLOSED_ENCUMBRANCE.detect({ evidence: [], pages: [search, disclosed] })).toEqual([]);
  });

  it('statement gap and verified growth', () => {
    const gap = [line('W1', '2025-06-30', '1', 'performance', 'BMI'), line('W1', '2026-06-30', '1', 'performance', 'BMI'), line('W2', '2025-12-31', '1', 'performance', 'ASCAP')];
    expect(MUSIC_STATEMENT_GAP.detect({ evidence: gap, pages: [] })[0]?.title).toBe('Missing statement period: BMI');
    const growing = PERIODS.map((period, index) => line('W1', period, String(100 + index * 20)));
    expect(MUSIC_VERIFIED_GROWTH.detect({ evidence: growing, pages: [] })[0]).toMatchObject({ direction: 1, valueConfirmation: { valueDriver: 'Catalog income growth' } });
    const flat = PERIODS.map((period) => line('W1', period, '100'));
    expect(MUSIC_VERIFIED_GROWTH.detect({ evidence: flat, pages: [] })).toEqual([]);
  });
});
