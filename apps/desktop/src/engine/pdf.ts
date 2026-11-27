import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * The canonical form (T-178): a normalized PDF with a text layer and stable page anchors (`p1`, `p2`, …,
 * one per page, recorded in the manifest so a citation names the same page on both sides).
 */
export const LINES_PER_PAGE = 46;

export interface CanonicalPdf {
  readonly bytes: Uint8Array;
  /** The text drawn on each page, exactly. */
  readonly pageTexts: string[];
  readonly anchors: string[];
}

/** Standard fonts encode WinAnsi only: anything else is replaced, never silently dropped. */
function printable(line: string): string {
  return line.replace(/[—–]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

/**
 * Draw lines onto pages. `stamp`, when given, is drawn at the top of every page (the hand-sourced mark).
 * Metadata is fixed (no creation clock), so the same lines always give the same bytes.
 */
export async function writeLinesPdf(lines: readonly string[], options: { title: string; stamp?: string } = { title: 'Document' }): Promise<CanonicalPdf> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(printable(options.title));
  pdf.setProducer('Pactlab Rinse');
  pdf.setCreator('Pactlab Rinse');
  const epoch = new Date(0);
  pdf.setCreationDate(epoch);
  pdf.setModificationDate(epoch);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageTexts: string[] = [];
  const body = lines.length > 0 ? lines : [''];
  for (let start = 0; start < body.length; start += LINES_PER_PAGE) {
    const page = pdf.addPage([612, 792]);
    const chunk = body.slice(start, start + LINES_PER_PAGE).map(printable);
    let y = 750;
    if (options.stamp) {
      page.drawRectangle({ x: 36, y: 758, width: 540, height: 20, color: rgb(0.41, 0.47, 1) });
      page.drawText(printable(options.stamp), { x: 44, y: 764, size: 9, font: bold, color: rgb(1, 1, 1) });
      y = 736;
    }
    for (const line of chunk) {
      page.drawText(line, { x: 48, y, size: 10, font, color: rgb(0.03, 0.07, 0.15) });
      y -= 15;
    }
    pageTexts.push([...(options.stamp && start > 0 ? [printable(options.stamp)] : []), ...chunk].join('\n'));
  }
  const bytes = await pdf.save({ useObjectStreams: false });
  return { bytes, pageTexts, anchors: pageTexts.map((_, index) => `p${index + 1}`) };
}

/** Text per real page of a PDF, as the pact reads it; null for an encrypted or unreadable file. */
export async function readPdfText(bytes: Uint8Array): Promise<string[] | null> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, enableXfa: false, stopAtErrors: true, disableRange: true, disableStream: true, verbosity: 0 });
  let document;
  try {
    document = await task.promise;
  } catch {
    return null;
  }
  try {
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const content = await (await document.getPage(number)).getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        text += item.hasEOL ? '\n' : item.str && !item.str.endsWith(' ') ? ' ' : '';
      }
      pages.push(text.replaceAll(/[ \t]+\n/g, '\n').replaceAll(/ {2,}/g, ' ').trim());
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
