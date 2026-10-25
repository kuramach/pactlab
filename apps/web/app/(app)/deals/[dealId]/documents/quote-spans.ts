/**
 * Which text items of a rendered PDF page hold a cited quote. The page's
 * items are joined the way the API extracts page text (an item, then a space
 * or line break), and both sides are compared with whitespace collapsed, so a
 * quote that wraps across lines still matches — the same rule `SourceIndex`
 * uses to verify citations. Returns item indexes, in order; none if absent.
 */
export function quoteSpans(items: readonly string[], quote: string): number[] {
  const wanted = collapse(quote);
  if (wanted === '') return [];
  // Collapsed page text, remembering which item each character came from.
  let text = '';
  const owner: number[] = [];
  items.forEach((item, index) => {
    for (const char of item) {
      const space = /\s/.test(char);
      if (space && (text === '' || text.endsWith(' '))) continue;
      text += space ? ' ' : char;
      owner.push(index);
    }
    if (text !== '' && !text.endsWith(' ')) {
      text += ' ';
      owner.push(index);
    }
  });
  const at = text.indexOf(wanted);
  if (at === -1) return [];
  return [...new Set(owner.slice(at, at + wanted.length))];
}

const collapse = (value: string) => value.replace(/\s+/g, ' ').trim();
