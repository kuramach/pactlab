import { FINANCIAL_PNL, MULTIFAMILY_RENT_ROLL } from '@pactlab/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReadingCard, readingFacts } from './reading-card';

describe('how Pactlab read the file (Kumar, 2026-11-25)', () => {
  it('says where the column names are, what the rows are and what is left to answer, in plain words', () => {
    const facts = readingFacts({
      definition: MULTIFAMILY_RENT_ROLL,
      headerRow: 3,
      header: ['Unit', 'Bldg', 'Tenant', 'Rent', 'Status', 'Move in'],
      rowCount: 120,
      layout: { kind: 'ROWS' },
      lineKinds: undefined,
      matched: 5,
      questions: 1,
    });
    expect(facts[0]).toBe('The column names are on row 3: “Unit”, “Bldg”, “Tenant”, “Rent” and 2 more.');
    expect(facts[1]).toBe('Rows 1–2 are titles, so they are skipped.');
    expect(facts[2]).toContain('are 120 rows; each row becomes one record');
    expect(facts.at(-1)).toContain('Pactlab has 1 question for you below.');
  });

  it('a P&L: the months across, and how many lines are totals that are checked, not imported', () => {
    const facts = readingFacts({
      definition: FINANCIAL_PNL,
      headerRow: 1,
      header: ['Account', 'Jan 2026', 'Feb 2026', 'Mar 2026'],
      rowCount: 6,
      layout: { kind: 'PERIOD_COLUMNS', periods: [{ column: 'Jan 2026', period: '2026-01' }, { column: 'Feb 2026', period: '2026-02' }, { column: 'Mar 2026', period: '2026-03' }] },
      lineKinds: { Subscriptions: 'REVENUE', Hosting: 'COGS', 'Gross profit': 'GROSS_PROFIT', Payroll: 'OPEX', 'Net income': 'NET_INCOME' },
      matched: 3,
      questions: 0,
    });
    expect(facts).toContain('Months run across the columns, Jan 2026 to Mar 2026 (3 months).');
    expect(facts).toContain('3 lines are income or costs and 2 are totals. Totals are checked against the lines, not imported.');
    expect(facts.join(' ')).not.toContain('question');
  });

  it('shows the AI’s words and its row groups, and asks whether that is right', () => {
    const html = renderToStaticMarkup(
      <ReadingCard
        facts={['The column names are on row 2.']}
        reading={{ summary: 'This is a monthly P&L.', rowGroups: [{ from: 1, to: 1, kind: 'TITLE', note: '' }, { from: 2, to: 2, kind: 'HEADER', note: '' }, { from: 3, to: 9, kind: 'DATA', note: '' }, { from: 10, to: 10, kind: 'SUBTOTAL', note: '' }] }}
        onExplain={() => undefined}
      />,
    );
    expect(html).toContain('Here’s how Pactlab read your file');
    expect(html).toContain('In the AI’s words');
    expect(html).toContain('This is a monthly P&amp;L.');
    expect(html).toContain('Rows 3–9: Data');
    expect(html).toContain('Row 10: Totals');
    expect(html).toContain('Yes, that’s right');
    expect(html).toContain('Not quite, let me explain');
  });

  it('without the assistant: the facts alone', () => {
    const html = renderToStaticMarkup(<ReadingCard facts={['The column names are on row 1.']} reading={null} onExplain={() => undefined} />);
    expect(html).not.toContain('In the AI’s words');
    expect(html).toContain('The column names are on row 1.');
  });
});
