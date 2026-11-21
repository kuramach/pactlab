import { IMPORT_TARGET_DEFINITIONS, IMPORT_TARGETS, type ImportTarget } from '@pactlab/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { unmappedRequired } from '../_lib/mapping-form';
import { MappingEditor } from './mapping-editor';

// The screen's server actions are not exercised here; the screen itself is.
vi.mock('../actions', () => ({ previewMapping: vi.fn(), importWithMapping: vi.fn(), cancelUpload: vi.fn(), chooseSheet: vi.fn(), chooseHeaderRow: vi.fn(), importProgressOf: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/** The mapping screen as a user sees it, for one import target, with the API's suggested mapping. */
function screen(target: ImportTarget) {
  const definition = IMPORT_TARGET_DEFINITIONS[target];
  const header = definition.fields.map((field) => field.name);
  const suggested = {
    target,
    fields: Object.fromEntries(header.map((name) => [name, { kind: 'column' as const, column: name }])),
    dateFormat: 'YYYY-MM-DD' as const,
    numberFormat: 'DOT_DECIMAL' as const,
    amountUnit: 'MAJOR' as const,
    negateAmounts: false,
  };
  return renderToStaticMarkup(
    <MappingEditor dealId="d" uploadId="u" header={header} sample={[header.map(() => 'x')]} suggested={suggested} />,
  );
}

describe('column-mapping screen', () => {
  it.each(IMPORT_TARGETS)('maps %s to its own fields, never billing fields by default', (target) => {
    const definition = IMPORT_TARGET_DEFINITIONS[target];
    const html = screen(target);
    for (const field of definition.fields) expect(html, `${target}: ${field.label}`).toContain(`Source for ${field.label.replaceAll('&', '&amp;')}`); // as rendered (HTML-escaped)
    if (target !== 'BILLING_INVOICE_LINE') {
      // The bug: a loan tape or rent roll was asked for invoice-line fields it can never have.
      expect(html).not.toContain('Source for Invoice id');
      expect(html).not.toContain('credit notes');
      expect(html).toContain(`Map columns to the ${definition.label.toLowerCase().replaceAll("&", "&amp;")}`);
    } else {
      expect(html).toContain('Map columns to the standard invoice line');
      expect(html).toContain('credit notes');
    }
  });

  it.each(IMPORT_TARGETS)('%s: a fully mapped file has nothing still required, and the screen offers Cancel', (target) => {
    const definition = IMPORT_TARGET_DEFINITIONS[target];
    const fields = Object.fromEntries(definition.fields.map((field) => [field.name, { kind: 'column' as const, column: field.name }]));
    expect(unmappedRequired({ target, fields, dateFormat: 'YYYY-MM-DD', numberFormat: 'DOT_DECIMAL', amountUnit: 'MAJOR', negateAmounts: false })).toEqual([]);
    expect(screen(target)).toContain('Cancel upload');
  });

  it('reports the target\'s own missing required fields', () => {
    const missing = unmappedRequired({ target: 'FINTECH_LOAN_TAPE', fields: {}, dateFormat: 'YYYY-MM-DD', numberFormat: 'DOT_DECIMAL', amountUnit: 'MAJOR', negateAmounts: false });
    expect(missing).toContain('Loan id');
    expect(missing).not.toContain('Line id');
  });
});

describe('the mapping assistant on screen (Kumar, 2026-11-21)', () => {
  const PERIODS = [
    { column: 'Jan 2026', period: '2026-01' },
    { column: 'Feb 2026', period: '2026-02' },
  ];

  function pnl(assist: Parameters<typeof MappingEditor>[0]['assist']) {
    return renderToStaticMarkup(
      <MappingEditor
        dealId="d"
        uploadId="u"
        header={['Column A', 'Jan 2026', 'Feb 2026']}
        sample={[
          ['Subscription revenue', '100', '110'],
          ['Total revenue', '100', '110'],
        ]}
        headerRow={3}
        preview={[['Northwind (synthetic)'], ['Income statement'], ['', 'Jan 2026', 'Feb 2026'], ['Subscription revenue', '100', '110']]}
        suggested={{
          target: 'FINANCIAL_PNL',
          fields: { account: { kind: 'column', column: 'Column A' }, month: { kind: 'column', column: 'Period (from columns)' }, amount: { kind: 'column', column: 'Amount (from columns)' } },
          dateFormat: 'YYYY-MM-DD',
          numberFormat: 'DOT_DECIMAL',
          amountUnit: 'MAJOR',
          negateAmounts: false,
          layout: { kind: 'PERIOD_COLUMNS', periods: PERIODS },
          lineKinds: { 'Subscription revenue': 'REVENUE', 'Total revenue': 'TOTAL_REVENUE' },
        }}
        assist={assist}
      />,
    );
  }

  it('marks what the assistant filled in, with its reason, and shows months across and the header row', () => {
    const html = pnl({ source: 'AI', picks: { account: { by: 'AI', confidence: 0.95, reason: 'The line labels down the first column' } }, questions: [], unsureLines: ['Total revenue'], note: null });
    expect(html).toContain('filled in what it was sure of');
    expect(html).toContain('The line labels down the first column');
    expect(html).toContain('Months run across the columns: Jan 2026 – Feb 2026 (2)');
    expect(html).toContain('Row 3:');
    expect(html).toContain('What each line is');
    expect(html).toContain('aria-label="Kind of line Total revenue"');
    expect(html).toContain('Months across the columns');
    expect(html).not.toContain('Pactlab needs you');
  });

  it('asks the assistant’s questions before anything can be imported', () => {
    const html = pnl({
      source: 'AI',
      picks: {},
      questions: [{ field: null, question: 'Two sheets look like the P&L. Is this the audited one?', options: [] }],
      unsureLines: [],
      note: null,
    });
    expect(html).toContain('Pactlab needs you before this can be imported');
    expect(html).toContain('Is this the audited one?');
    expect(html).toContain('Answer Pactlab’s questions above to import.');
  });

  it('says plainly when the assistant did not help', () => {
    const html = pnl({ source: 'NAMES', picks: {}, questions: [], unsureLines: [], note: 'Columns were matched by name only: the mapping assistant is off.' });
    expect(html).toContain('the mapping assistant is off');
    expect(html).not.toContain('filled in what it was sure of');
  });
});
