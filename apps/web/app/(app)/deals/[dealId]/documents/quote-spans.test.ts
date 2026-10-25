import { describe, expect, it } from 'vitest';
import { quoteSpans } from './quote-spans';

describe('quoteSpans', () => {
  const items = ['22.3 Change of control. The Bank may', 'terminate this Agreement on thirty days', 'notice if the Partner undergoes a change', 'of control.', 'Page 2'];

  it('finds a quote that wraps across lines', () => {
    expect(quoteSpans(items, 'The Bank may terminate this Agreement on thirty days notice')).toEqual([0, 1, 2]);
  });

  it('ignores differences in whitespace', () => {
    expect(quoteSpans(['Term  loan', 'outstanding:   USD 120,000'], 'Term loan outstanding: USD 120,000')).toEqual([0, 1]);
  });

  it('returns nothing for a quote not on the page, or an empty quote', () => {
    expect(quoteSpans(items, 'indemnity cap')).toEqual([]);
    expect(quoteSpans(items, '   ')).toEqual([]);
  });
});
