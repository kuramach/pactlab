import { createHash } from 'node:crypto';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

/** Where each signatory signs; DocuSign places its sign-here tab on these strings (T-107). */
export const SIGN_ANCHORS = { BUYER: '/pl-buyer-sign/', SELLER: '/pl-seller-sign/' } as const;

export const TERM_TITLES: Readonly<Record<string, string>> = {
  PURCHASE_PRICE: 'Purchase price',
  PRICE_REDUCTION: 'Price reduction',
  REMEDIATION_COST: 'Remediation cost',
  ESCROW: 'Escrow holdback',
  INDEMNITY: 'Specific indemnity',
  RETENTION: 'Retention holdback',
  EARNOUT: 'Earnout',
  SELLER_FINANCING: 'Seller note',
  FINANCING_CONTINGENCY: 'Financing contingency',
};

export interface TermSheetInput {
  readonly dealName: string;
  readonly buyerName: string;
  readonly sellerName: string;
  readonly version: number;
  readonly agreedAt: string;
  readonly terms: readonly { readonly lever: string; readonly amount: string; readonly currency: string; readonly note: string; readonly dueOn?: string | null }[];
  readonly signatories: { readonly buyer: string; readonly seller: string };
}

const money = (amount: string, currency: string) => {
  const [whole = '0', fraction = '00'] = amount.split('.');
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0').slice(0, 2)}`;
};

/** Standard fonts encode WinAnsi only: anything else is replaced, never dropped silently. */
const safe = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

/**
 * The term sheet both sides sign (T-107): the parties, the agreed version's
 * terms (headline price first) and a signature block per side. Built only
 * from what both sides already see; never a persona, finding or pricing
 * parameter. Deterministic for the same input, so its digest identifies it.
 */
export async function termSheetPdf(input: TermSheetInput): Promise<{ bytes: Uint8Array; sha256: string }> {
  const pdf = await PDFDocument.create();
  // Fixed metadata so the same agreed version always produces the same bytes.
  const fixed = new Date(input.agreedAt);
  pdf.setCreationDate(fixed);
  pdf.setModificationDate(fixed);
  pdf.setProducer('Pactlab');
  pdf.setCreator('Pactlab');
  pdf.setTitle(safe(`${input.dealName} - agreed terms v${input.version}`));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([595, 842]);
  let y = 790;
  const write = (text: string, font: PDFFont, size: number, indent = 50) => {
    if (y < 80) {
      page = pdf.addPage([595, 842]);
      y = 790;
    }
    page.drawText(safe(text), { x: indent, y, size, font, color: rgb(0.03, 0.07, 0.15) });
    y -= size + 8;
  };

  write('Term sheet', bold, 22);
  write(input.dealName, bold, 14);
  write(`Buyer: ${input.buyerName}`, regular, 11);
  write(`Seller: ${input.sellerName}`, regular, 11);
  write(`Agreed version ${input.version}, ${input.agreedAt.slice(0, 10)}`, regular, 11);
  y -= 10;
  write('Terms', bold, 13);
  for (const term of input.terms) {
    write(`${TERM_TITLES[term.lever] ?? term.lever}: ${money(term.amount, term.currency)}${term.dueOn ? `, financing in place by ${term.dueOn}` : ''}`, bold, 11);
    if (term.note) write(term.note.slice(0, 300), regular, 10, 66);
  }
  y -= 16;
  write('This term sheet records the commercial terms agreed on Pactlab. It is not the definitive agreement unless the parties attach and sign one.', regular, 9);
  y -= 24;
  for (const [side, name, anchor] of [
    ['Buyer', input.signatories.buyer, SIGN_ANCHORS.BUYER],
    ['Seller', input.signatories.seller, SIGN_ANCHORS.SELLER],
  ] as const) {
    write(`For the ${side.toLowerCase()}: ${name}`, bold, 11);
    // The anchor is printed in white where the signature goes, for the e-signature provider to find.
    page.drawText(anchor, { x: 50, y, size: 8, font: regular, color: rgb(1, 1, 1) });
    page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: 300, y: y - 4 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
    y -= 40;
  }
  const bytes = await pdf.save({ useObjectStreams: false });
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
