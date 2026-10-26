import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence, PackRulePage } from '../rule-types';
import { VENTURE_CAP_TABLE_RECORD, VENTURE_DECK_METRIC, VENTURE_IP_ASSIGNMENT, VENTURE_MISSING_83B, VENTURE_RUNWAY_SHORT, VENTURE_SAFE_STACK, VENTURE_TERM_VARIANCE, VENTURE_UNDISCLOSED_CONCENTRATION } from './rules';

const row = (evidenceType: string, id: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const page = (documentId: string, pageNumber: number, text: string): PackRulePage => ({ documentId, pageNumber, text });
const line = (id: string, name: string, amount: string) => row('billing.invoice_line', id, { customer_name: name, amount, currency: 'USD', interval: 'month', interval_count: '1', period_start: '2026-09-01' });
const deck = (...lines: string[]) => [page('deck', 1, 'Acme — seed round investor deck (synthetic)'), page('deck', 2, lines.join('\n'))];
const cap = (id: string, values: Record<string, string>) => row('venture.cap_table_row', id, { security_id: id, ...values });

describe('venture raise rules (T-083)', () => {
  it('deck ARR more than 2% above billing is a contradicted claim; within 0.5% it ties', () => {
    const billing = [line('a', 'One', '60000'), line('b', 'Two', '40000')]; // MRR 100,000 → ARR 1,200,000
    const [high] = VENTURE_DECK_METRIC.detect({ evidence: billing, pages: deck('ARR at 30 September 2026: USD 1,260,000') });
    expect(high).toMatchObject({ direction: -1, title: 'Deck ARR contradicted by billing', claim: { status: 'CONTRADICTED', statement: 'ARR at 30 September 2026: USD 1,260,000' } });
    expect(high?.description).toContain('the deck is 5.0% higher');
    const [ties] = VENTURE_DECK_METRIC.detect({ evidence: billing, pages: deck('ARR at 30 September 2026: USD 1,203,000') });
    expect(ties).toMatchObject({ direction: 1, claim: { status: 'VERIFIED' } });
    expect(VENTURE_DECK_METRIC.detect({ evidence: billing, pages: deck('ARR at 30 September 2026: USD 1,215,000') })).toEqual([]);
    expect(VENTURE_DECK_METRIC.detect({ evidence: billing, pages: [page('memo', 1, 'ARR: USD 9,000,000')] })).toEqual([]);
  });

  it('an annual line counts a twelfth toward MRR', () => {
    const billing = [row('billing.invoice_line', 'y', { customer_name: 'Yearly', amount: '120000', currency: 'USD', interval: 'year', interval_count: '1', period_start: '2026-09-01' })];
    expect(VENTURE_DECK_METRIC.detect({ evidence: billing, pages: deck('MRR in September: USD 10,000') })[0]).toMatchObject({ direction: 1 });
  });

  it('IP assignment: each contractor agreement without an assignment is a gap; all assigning is a cushion', () => {
    const assigns = [page('n', 1, 'Independent contractor agreement — Acme and Northbeam (synthetic)'), page('n', 2, 'Contractor hereby assigns to the Company all inventions and work product.')];
    const gap = [page('q', 1, 'Independent contractor agreement — Acme and Quillfield (synthetic)'), page('q', 2, 'Contractor will design screens.')];
    expect(VENTURE_IP_ASSIGNMENT.detect({ evidence: [], pages: [...assigns, ...gap] }).map((entry) => [entry.title, entry.key])).toEqual([['IP assignment gap', 'ip-gap:q']]);
    expect(VENTURE_IP_ASSIGNMENT.detect({ evidence: [], pages: assigns })[0]).toMatchObject({ title: 'IP assignment chain complete', direction: 1 });
    expect(VENTURE_IP_ASSIGNMENT.detect({ evidence: [], pages: [page('x', 1, 'Board minutes')] })).toEqual([]);
  });

  it('cap table against the corporate record, to the share', () => {
    const rows = [cap('CS-1', { instrument: 'common', shares: '6000000' }), cap('CS-2', { instrument: 'common', shares: '3000000' }), cap('OP-1', { instrument: 'option', shares: '500000' })];
    const record = (n: string) => [page('coi', 2, `Issued and outstanding: ${n} shares of Common Stock.`)];
    expect(VENTURE_CAP_TABLE_RECORD.detect({ evidence: rows, pages: record('9,000,000') })[0]).toMatchObject({ direction: 1 });
    expect(VENTURE_CAP_TABLE_RECORD.detect({ evidence: rows, pages: record('9,250,000') })[0]).toMatchObject({ direction: -1, description: expect.stringContaining('250,000 apart') });
  });

  it('SAFE stack: an understated total and a triggered MFN', () => {
    const rows = [
      cap('SAFE-1', { instrument: 'safe', principal: '250000', valuation_cap: '8000000', mfn: 'yes', issued_on: '2024-11-15' }),
      cap('SAFE-2', { instrument: 'safe', principal: '400000', valuation_cap: '6000000', issued_on: '2025-09-01' }),
    ];
    const [found] = VENTURE_SAFE_STACK.detect({ evidence: rows, pages: deck('SAFEs outstanding: USD 250,000') });
    expect(found?.description).toMatch(/^the deck states 250,000 outstanding; the cap table holds 650,000 across 2 instruments; SAFE-1 has a most-favoured-nation clause, so it takes SAFE-2's cap of 6,000,000/);
    expect(VENTURE_SAFE_STACK.detect({ evidence: [rows[1] as PackRuleEvidence], pages: deck('SAFEs outstanding: USD 400,000') })).toEqual([]);
  });

  it('runway from cash over three months of burn, against the deck', () => {
    const months = ['2026-07', '2026-08', '2026-09'].map((month, index) => row('venture.financials_month', month, { month, cash_balance: String(1_500_000 + (2 - index) * 120_000), net_burn: '120000' }));
    const [found] = VENTURE_RUNWAY_SHORT.detect({ evidence: months, pages: deck('Runway: 18 months at current burn') });
    expect(found).toMatchObject({ claim: { status: 'CONTRADICTED' } });
    expect(found?.description).toMatch(/is 12\.5 months — 5\.5 months less/);
    expect(VENTURE_RUNWAY_SHORT.detect({ evidence: months, pages: deck('Runway: 13 months') })).toEqual([]);
  });

  it('83(b): founders with vesting stock missing from the confirmations', () => {
    const rows = [cap('CS-1', { holder_ref: 'F-1', holder_type: 'founder', vesting: 'yes' }), cap('CS-2', { holder_ref: 'F-2', holder_type: 'founder', vesting: 'yes' })];
    const confirmations = [page('c', 1, 'Section 83(b) election confirmations'), page('c', 2, 'Holder F-1: election filed.')];
    expect(VENTURE_MISSING_83B.detect({ evidence: rows, pages: confirmations })[0]).toMatchObject({ key: 'F-2', evidenceIds: ['CS-2'] });
    expect(VENTURE_MISSING_83B.detect({ evidence: rows, pages: [] })).toEqual([]);
  });

  it('concentration the deck does not disclose', () => {
    const billing = [line('a', 'Big Co', '400'), line('b', 'Small Co', '600'), line('c', 'Tiny Co', '100')];
    expect(VENTURE_UNDISCLOSED_CONCENTRATION.detect({ evidence: billing, pages: deck('Customers: 3 paying teams.') })).toHaveLength(1);
    expect(VENTURE_UNDISCLOSED_CONCENTRATION.detect({ evidence: billing, pages: deck('Our largest customer is 55% of revenue.') })).toEqual([]);
  });

  it('term variance: a participating preference and the board, as neutral consequences', () => {
    const sheet = [page('t', 1, 'Seed term sheet (synthetic)'), page('t', 2, 'Liquidation preference: 2x participating.\nBoard: two founder directors and two investor directors.')];
    const found = VENTURE_TERM_VARIANCE.detect({ evidence: [], pages: sheet });
    expect(found.map((entry) => [entry.title, entry.direction])).toEqual([
      ['Liquidation preference above the baseline', 0],
      ['Board composition after the round', 0],
    ]);
    expect(VENTURE_TERM_VARIANCE.detect({ evidence: [], pages: [page('t', 1, 'Term sheet'), page('t', 2, 'Liquidation preference: 1x non-participating.')] })).toEqual([]);
  });
});
