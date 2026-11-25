import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GuidancePanel } from './guidance-panel';

vi.mock('../actions', () => ({ saveGuidance: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const grid = [['Acme LLC'], ['Rent roll'], ['Unit', 'Rent'], ['101', '1850']];

describe('guidance panel (T-152)', () => {
  it('quotes back what the AI was told, instructions and row notes', () => {
    const html = renderToStaticMarkup(
      <GuidancePanel dealId="d" uploadId="u" grid={grid} disabled={false} guidance={{ instructions: 'Amounts are annual', annotations: [{ fromRow: 1, toRow: 2, note: 'title rows' }, { fromRow: 14, toRow: 14, note: 'subtotal' }] }} />,
    );
    expect(html).toContain('The AI was told:');
    expect(html).toContain('Amounts are annual');
    expect(html).toContain('rows 1–2:');
    expect(html).toContain('row 14:');
    // Open for editing, with the starters and a checkbox per grid row.
    expect(html).toContain('Amounts are monthly');
    expect(html).toContain('Select row 4');
  });

  it('with nothing said, offers to add guidance', () => {
    const html = renderToStaticMarkup(<GuidancePanel dealId="d" uploadId="u" grid={grid} disabled={false} guidance={null} />);
    expect(html).toContain('Nothing yet');
    expect(html).toContain('Add instructions or row notes');
    expect(html).not.toContain('Select row 1');
  });
});
