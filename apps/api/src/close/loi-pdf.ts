import { createHash } from 'node:crypto';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { brandFontFile, documentColors, POWERED_BY, type DocumentBrand } from '../brand/document-brand';
import type { LoiContent } from './loi-content';
import { SIGN_ANCHORS } from './term-sheet';

/** Standard fonts encode WinAnsi only: anything else is replaced, never dropped silently. */
const safe = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

/**
 * The letter of intent as signed (T-119): two labelled parts — non-binding intent and binding
 * provisions — a signature block that says only the binding part binds, and the counsel notice
 * on every page. Deterministic for the same content and date, so its digest identifies it.
 */
export async function loiPdf(
  content: LoiContent,
  input: { version: number; issuedAt: string; signatories: { buyer: string; seller: string }; brand?: DocumentBrand | null },
): Promise<{ bytes: Uint8Array; sha256: string }> {
  const brand = input.brand ?? null;
  const pdf = await PDFDocument.create();
  const fixed = new Date(input.issuedAt);
  pdf.setCreationDate(fixed);
  pdf.setModificationDate(fixed);
  pdf.setProducer('Pactlab');
  pdf.setCreator('Pactlab');
  pdf.setTitle(safe(`Letter of intent v${input.version}`));
  // Pactlab's letter keeps the standard fonts; a branded one (T-123) embeds the kit's font, logo and colors.
  let regular: PDFFont;
  let bold: PDFFont;
  let logo: PDFImage | null = null;
  if (brand) {
    pdf.registerFontkit(fontkit);
    regular = await pdf.embedFont(brandFontFile(brand.font, 400), { subset: true });
    bold = await pdf.embedFont(brandFontFile(brand.font, 700), { subset: true });
    if (brand.logo) logo = await (brand.logo.type === 'image/png' ? pdf.embedPng(brand.logo.bytes) : pdf.embedJpg(brand.logo.bytes));
  } else {
    regular = await pdf.embedFont(StandardFonts.Helvetica);
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  }
  const INK = rgb(0.03, 0.07, 0.15);
  const colors = documentColors(brand, { ink: INK, accent: INK });
  const pages: PDFPage[] = [];
  let page: PDFPage = pdf.addPage([595, 842]);
  pages.push(page);
  let y = 790;
  const newPage = () => {
    page = pdf.addPage([595, 842]);
    pages.push(page);
    y = 790;
  };
  const write = (text: string, font: PDFFont, size: number, indent = 50, color = INK) => {
    const width = 545 - indent;
    const words = safe(text).split(/\s+/);
    let line = '';
    const flush = () => {
      if (y < 80) newPage();
      page.drawText(line, { x: indent, y, size, font, color });
      y -= size + 6;
      line = '';
    };
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) flush();
      line = line ? `${line} ${word}` : word;
    }
    if (line) flush();
  };

  if (logo) {
    const scale = Math.min(120 / logo.width, 48 / logo.height);
    page.drawImage(logo, { x: 50, y: y - logo.height * scale + 12, width: logo.width * scale, height: logo.height * scale });
    y -= logo.height * scale + 16;
  } else if (brand) {
    write(brand.name, bold, 16, 50, colors.ink);
    y -= 6;
  }
  write(content.title, bold, 22, 50, colors.ink);
  write(`Version ${input.version}, ${input.issuedAt.slice(0, 10)}`, regular, 10);
  write(content.parties, regular, 11);
  y -= 10;
  write('Non-binding provisions', bold, 14, 50, colors.accent);
  write('Statements of present intent only. No obligation to close.', regular, 9);
  for (const section of content.nonBinding) {
    write(section.heading, bold, 11);
    for (const line of section.lines) write(line, regular, 10, 62);
  }
  y -= 10;
  write('Binding provisions', bold, 14, 50, colors.accent);
  write('These provisions bind both parties from countersignature.', regular, 9);
  for (const section of content.binding) {
    write(section.heading, bold, 11);
    for (const line of section.lines) write(line, regular, 10, 62);
  }
  y -= 14;
  write(content.signatureNote, bold, 10);
  y -= 20;
  for (const [side, name, anchor] of [
    ['buyer', input.signatories.buyer, SIGN_ANCHORS.BUYER],
    ['seller', input.signatories.seller, SIGN_ANCHORS.SELLER],
  ] as const) {
    if (y < 120) newPage();
    write(`For the ${side}: ${name}`, bold, 11);
    // Printed in white where the signature goes, for the e-signature provider to find.
    page.drawText(anchor, { x: 50, y, size: 8, font: regular, color: rgb(1, 1, 1) });
    page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: 300, y: y - 4 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
    y -= 40;
  }
  for (const each of pages) {
    each.drawText(safe(content.notice), { x: 50, y: 40, size: 8, font: regular, color: rgb(0.4, 0.4, 0.45) });
    if (brand) each.drawText(POWERED_BY, { x: 50, y: 28, size: 7, font: bold, color: rgb(0.4, 0.4, 0.45) });
  }
  const bytes = await pdf.save({ useObjectStreams: false });
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
