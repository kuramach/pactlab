import { unzipSync } from 'fflate';
import type { RinseFileKind } from '@pactlab/domain';
import { readPdfText } from './pdf';

/**
 * Reading the ORIGINAL independently of its conversion (T-178): for native files, the embedded text
 * layer; a scan has none, and is read from its image by the vision lane when online. A flow format
 * (Word, text) has no fixed pages, so its text is one reading compared by figures, not by page.
 */
export interface OriginalText {
  /** Text per page; null when the file has no text layer (a scan, an image). */
  readonly pageTexts: string[] | null;
  /** Fixed-page formats (PDF) are held to page-count parity; flow formats are not. */
  readonly fixedPages: boolean;
}

const XML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (text: string) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => XML_ENTITIES[name] ?? '').replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));

/** Word's text layer: each paragraph of `word/document.xml` is a line; tabs and breaks are kept. */
export function docxText(bytes: Uint8Array): string | null {
  let entries;
  try {
    entries = unzipSync(bytes, { filter: (file) => file.name === 'word/document.xml' && file.originalSize <= 20 * 1024 * 1024 });
  } catch {
    return null;
  }
  const xml = entries['word/document.xml'];
  if (!xml) return null;
  const source = new TextDecoder().decode(xml);
  return source
    .split(/<\/w:p>/)
    .map((paragraph) =>
      [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
        .map((match) => (match[1] !== undefined ? decodeXml(match[1]) : match[0] === '<w:tab/>' ? '\t' : '\n'))
        .join('')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join('\n');
}

export async function readOriginalText(kind: RinseFileKind, bytes: Uint8Array): Promise<OriginalText> {
  switch (kind) {
    case 'PDF':
      return { pageTexts: await readPdfText(bytes), fixedPages: true };
    case 'WORD': {
      const text = docxText(bytes);
      return { pageTexts: text === null ? null : [text], fixedPages: false };
    }
    case 'TEXT':
      return { pageTexts: [new TextDecoder().decode(bytes)], fixedPages: false };
    default:
      return { pageTexts: null, fixedPages: true };
  }
}
