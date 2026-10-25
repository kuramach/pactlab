import { readWorkbookSheets, TableReadError } from '@pactlab/connectors';
import { DOCX_CONTENT_TYPE, XLSX_CONTENT_TYPE, type AcceptedContentType } from './documents.types';
import { ExtractionError, extractPages, MAX_PAGES, TARGET_PAGE_CHARS, type ExtractedPage } from './extraction';
import { sha256Hex } from '@pactlab/ai';

/** A PDF page with fewer characters than this is treated as having no text layer. */
const MIN_PAGE_CHARS = 20;
export const EXTRACTION_TIMEOUT_MS = 30_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ExtractionError('TIMEOUT')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * PDF text per real page, so a citation's page number is the page a reader
 * sees. Encrypted PDFs are refused; a PDF without a text layer (scanned)
 * needs OCR, which is not available yet. Font loading, XFA and network
 * fetching are off; only the bytes given are read.
 */
async function pdfPages(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: true,
    disableRange: true,
    disableStream: true,
    verbosity: 0,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    throw new ExtractionError(error instanceof Error && error.name === 'PasswordException' ? 'ENCRYPTED' : 'UNREADABLE');
  }
  try {
    if (pdf.numPages > MAX_PAGES) throw new ExtractionError('TOO_MANY_PAGES');
    const pages: ExtractedPage[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
        else if (item.str && !item.str.endsWith(' ')) text += ' ';
      }
      text = text.replaceAll(/[ \t]+\n/g, '\n').replaceAll(/ {2,}/g, ' ').trim();
      pages.push({ pageNumber: number, text, checksum: sha256Hex(text) });
    }
    const characters = pages.reduce((total, page) => total + page.text.length, 0);
    if (characters < MIN_PAGE_CHARS * Math.max(1, Math.ceil(pages.length / 2))) throw new ExtractionError('NEEDS_OCR');
    return pages;
  } finally {
    await task.destroy();
  }
}

/** Word has no fixed pages: its text is split into sections like a text file. */
async function docxPages(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const mammoth = await import('mammoth');
  let text: string;
  try {
    text = (await mammoth.default.extractRawText({ buffer: Buffer.from(bytes) })).value;
  } catch {
    throw new ExtractionError('UNREADABLE');
  }
  return extractPages(text);
}

/**
 * An Excel workbook: each sheet starts a new page headed with its name, rows
 * as tab-separated lines; a long sheet continues over further pages. Cell
 * values are text exactly as `readTable` reads them (exact decimals, ISO dates).
 */
async function workbookPages(bytes: Uint8Array): Promise<ExtractedPage[]> {
  let sheets;
  try {
    sheets = await readWorkbookSheets(bytes);
  } catch (error) {
    throw new ExtractionError(error instanceof TableReadError && error.code === 'NO_DATA' ? 'NO_TEXT' : 'UNREADABLE');
  }
  const pages: string[] = [];
  for (const { sheet, rows } of sheets) {
    let page = `Sheet: ${sheet}`;
    for (const row of rows) {
      const line = row.join('\t');
      if (page.length + line.length + 1 > TARGET_PAGE_CHARS && page.includes('\n')) {
        pages.push(page);
        page = `Sheet: ${sheet} (continued)`;
      }
      page += `\n${line}`;
    }
    pages.push(page);
    if (pages.length > MAX_PAGES) throw new ExtractionError('TOO_MANY_PAGES');
  }
  return extractPages(pages.join('\f'));
}

/**
 * Pages of text for any accepted document, bounded in time. The original
 * bytes are stored unchanged; only this text is cited and shown.
 */
export async function documentPages(upload: { contentType: AcceptedContentType; bytes: Uint8Array; text: string | null }): Promise<ExtractedPage[]> {
  switch (upload.contentType) {
    case 'application/pdf':
      return withTimeout(pdfPages(upload.bytes), EXTRACTION_TIMEOUT_MS);
    case DOCX_CONTENT_TYPE:
      return withTimeout(docxPages(upload.bytes), EXTRACTION_TIMEOUT_MS);
    case XLSX_CONTENT_TYPE:
      return withTimeout(workbookPages(upload.bytes), EXTRACTION_TIMEOUT_MS);
    default:
      return extractPages(upload.text ?? '');
  }
}
