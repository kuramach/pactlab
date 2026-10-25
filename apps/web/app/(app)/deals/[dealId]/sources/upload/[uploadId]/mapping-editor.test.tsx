import { IMPORT_TARGET_DEFINITIONS, IMPORT_TARGETS, type ImportTarget } from '@pactlab/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { unmappedRequired } from '../_lib/mapping-form';
import { MappingEditor } from './mapping-editor';

// The screen's server actions are not exercised here; the screen itself is.
vi.mock('../actions', () => ({ previewMapping: vi.fn(), importWithMapping: vi.fn(), cancelUpload: vi.fn(), chooseSheet: vi.fn(), importProgressOf: vi.fn() }));
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
      expect(html).toContain(`Map columns to the ${definition.label.toLowerCase()}`);
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
