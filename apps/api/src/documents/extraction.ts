import { sha256Hex } from '@pactlab/ai';

/** Target size for pages of text files without explicit page breaks. */
export const TARGET_PAGE_CHARS = 3000;
export const MAX_PAGES = 500;

export interface ExtractedPage {
  readonly pageNumber: number;
  readonly text: string;
  readonly checksum: string;
}

export class ExtractionError extends Error {
  constructor(readonly reason: 'NO_TEXT' | 'TOO_MANY_PAGES') {
    super(`Extraction failed: ${reason}`);
    this.name = 'ExtractionError';
  }
}

function chunk(text: string): string[] {
  const pages: string[] = [];
  let rest = text;
  while (rest.length > TARGET_PAGE_CHARS) {
    const window = rest.slice(0, TARGET_PAGE_CHARS);
    const paragraph = window.lastIndexOf('\n\n');
    const line = window.lastIndexOf('\n');
    const cut =
      paragraph > TARGET_PAGE_CHARS / 2
        ? paragraph
        : line > TARGET_PAGE_CHARS / 2
          ? line
          : TARGET_PAGE_CHARS;
    pages.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  pages.push(rest);
  return pages;
}

/**
 * Split extracted text into pages. Form feeds are authoritative page breaks;
 * text without them is paged at paragraph boundaries. Each page carries a
 * checksum so citations can be re-verified later.
 */
export function extractPages(text: string): ExtractedPage[] {
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const raw = normalized.includes('\f') ? normalized.split('\f') : chunk(normalized);
  const pages = raw.map((page) => page.replace(/^\n+/, '').trimEnd());
  while (pages.length > 0 && pages[pages.length - 1] === '') pages.pop();
  if (pages.every((page) => page.trim() === '')) throw new ExtractionError('NO_TEXT');
  if (pages.length > MAX_PAGES) throw new ExtractionError('TOO_MANY_PAGES');
  return pages.map((page, index) => ({
    pageNumber: index + 1,
    text: page,
    checksum: sha256Hex(page),
  }));
}
