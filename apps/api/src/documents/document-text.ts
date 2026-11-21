import { readWorkbookSheets, TableReadError } from '@pactlab/connectors';
import { DOCX_CONTENT_TYPE, PPTX_CONTENT_TYPE, XLSX_CONTENT_TYPE, type AcceptedContentType } from './documents.types';
import { MAX_VISION_PAGES, officeMedia, pdfPagesWithImages, pptxSlides } from './page-images';
import { ExtractionError, extractPages, MAX_PAGES, TARGET_PAGE_CHARS, type ExtractedPage } from './extraction';
import { sha256Hex } from '@pactlab/ai';

/** A PDF page with fewer characters than this is treated as having no text layer. */
const MIN_PAGE_CHARS = 20;
/** A page with pictures and fewer characters than this is also read from its image (a chart, an image table). */
const IMAGE_PAGE_CHARS = 600;
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
    // A scan (no text layer): every page is read from its image after upload (T-121), up to the cap.
    if (characters < MIN_PAGE_CHARS * Math.max(1, Math.ceil(pages.length / 2))) {
      return pages.map((page) => (page.pageNumber <= MAX_VISION_PAGES ? { ...page, vision: 'REPLACE' as const } : page));
    }
    // A text PDF: pages with pictures and little text may hold a chart or an image table; their images are read too.
    const withImages = await pdfPagesWithImages(bytes);
    let read = 0;
    return pages.map((page) => {
      if (!withImages.has(page.pageNumber) || page.text.length >= IMAGE_PAGE_CHARS || read >= MAX_VISION_PAGES) return page;
      read += 1;
      return { ...page, vision: 'APPEND' as const };
    });
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
/** A PowerPoint deck (T-121): one page per slide, its text and speaker notes; slides with pictures are also read from them. */
function pptxPages(bytes: Uint8Array): ExtractedPage[] {
  let slides;
  try {
    slides = pptxSlides(bytes);
  } catch {
    throw new ExtractionError('UNREADABLE');
  }
  if (slides.length === 0) throw new ExtractionError('NO_TEXT');
  if (slides.length > MAX_PAGES) throw new ExtractionError('TOO_MANY_PAGES');
  let read = 0;
  return slides.map((slide) => {
    const text = `Slide ${slide.number}${slide.text ? `\n${slide.text}` : ''}`;
    const vision = slide.images.length > 0 && read < MAX_VISION_PAGES ? (read++, slide.text ? ('APPEND' as const) : ('REPLACE' as const)) : undefined;
    return { pageNumber: slide.number, text, checksum: sha256Hex(text), ...(vision ? { vision } : {}) };
  });
}

/** An uploaded image (T-121): one page, read from the image after upload. */
function imagePage(): ExtractedPage[] {
  return [{ pageNumber: 1, text: '', checksum: sha256Hex(''), vision: 'REPLACE' }];
}

/** The pictures inside a Word or Excel file (T-121): each becomes a page after the text, read from the picture. */
function withMediaPages(pages: ExtractedPage[], bytes: Uint8Array, folder: 'word/media/' | 'xl/media/'): ExtractedPage[] {
  let media: string[];
  try {
    media = officeMedia(bytes, folder);
  } catch {
    return pages;
  }
  const extra = media.slice(0, MAX_VISION_PAGES).map((_, index) => ({ pageNumber: pages.length + index + 1, text: '', checksum: sha256Hex(''), vision: 'REPLACE' as const }));
  return [...pages, ...extra];
}

export async function documentPages(upload: { contentType: AcceptedContentType; bytes: Uint8Array; text: string | null }): Promise<ExtractedPage[]> {
  switch (upload.contentType) {
    case 'application/pdf':
      return withTimeout(pdfPages(upload.bytes), EXTRACTION_TIMEOUT_MS);
    case DOCX_CONTENT_TYPE:
      return withMediaPages(await withTimeout(docxPages(upload.bytes), EXTRACTION_TIMEOUT_MS), upload.bytes, 'word/media/');
    case XLSX_CONTENT_TYPE:
      return withMediaPages(await withTimeout(workbookPages(upload.bytes), EXTRACTION_TIMEOUT_MS), upload.bytes, 'xl/media/');
    case PPTX_CONTENT_TYPE:
      return pptxPages(upload.bytes);
    case 'image/png':
    case 'image/jpeg':
      return imagePage();
    default:
      return extractPages(upload.text ?? '');
  }
}
