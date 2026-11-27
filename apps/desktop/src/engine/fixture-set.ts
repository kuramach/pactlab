import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { PDFDocument, rgb } from 'pdf-lib';
import type { Classification, RinseAiClient } from './ai-queue';
import { writeLinesPdf } from './pdf';

/**
 * A messy synthetic seller set for tests and demos (T-178): Word statements, a scan, a spreadsheet, a
 * duplicate, a corrupt file, and one expected document missing. Everything is invented.
 */
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A minimal Word file whose paragraphs are the given lines. */
export function docx(lines: readonly string[]): Uint8Array {
  const body = lines.map((line) => `<w:p><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`).join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
  });
}

/** A spreadsheet's bytes: a zip, as an .xlsx is. Its rows are never read by Rinse; guided import reads them. */
export function xlsx(csv: string): Uint8Array {
  return zipSync({ 'xl/worksheets/sheet1.xml': strToU8(`<sheetData>${xml(csv)}</sheetData>`) });
}

/** A scanned page: a PDF holding only a drawing, with no text layer. */
export async function scanPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 60, y: 300, width: 480, height: 400, color: rgb(0.9, 0.9, 0.9) });
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  return pdf.save({ useObjectStreams: false });
}

export const INCOME_LINES = [
  'Harbour Lane Apartments LLC - income statement, year to 30 September 2026 (synthetic)',
  'Statement date: 2026-09-30',
  'Rental income: USD 1,642,000',
  'Other income: USD 58,000',
  'Total revenue: USD 1,700,000',
];
export const BALANCE_LINES = ['Harbour Lane Apartments LLC - balance sheet at 30 September 2026 (synthetic)', 'Cash: USD 420,000', 'Tenant receivables: USD 38,000', 'Total current assets: USD 458,000'];
/** What the operating statement scan truly says, as the vision lane reads it from the image. */
export const OPERATING_SCAN_TRUE = ['Harbour Lane Apartments LLC - operating statement FY2026 (synthetic)', 'Gross potential rent: USD 1,500,000', 'Other income: USD 200,000', 'Total revenue: USD 1,700,000'];
/** What a careless OCR pass made of it: the revenue total mis-read. */
export const OPERATING_SCAN_MISREAD = OPERATING_SCAN_TRUE.map((line) => line.replace('Total revenue: USD 1,700,000', 'Total revenue: USD 1,100,000'));
export const LEASE_LINES = ['COMMERCIAL LEASE - GROUND FLOOR RETAIL UNIT (synthetic)', 'Landlord: Harbour Lane Apartments LLC. Tenant: Quayside Coffee Ltd.', 'Term: 2024-03-01 to 2029-02-28.', 'Annual rent: USD 42,000'];

export async function messySet(): Promise<{ path: string; bytes: Uint8Array }[]> {
  const income = docx(INCOME_LINES);
  return [
    { path: 'Financials/Income statement FY2026.docx', bytes: income },
    { path: 'Financials/Copy of Income statement FY2026.docx', bytes: income },
    { path: 'Financials/Balance sheet Sept 2026.docx', bytes: docx(BALANCE_LINES) },
    { path: 'Scans/Operating statement FY2026.pdf', bytes: await scanPdf() },
    { path: 'Rent roll/Rent roll Sept 2026.xlsx', bytes: xlsx('unit,status,in_place_rent\n101,occupied,1240.00') },
    { path: 'Operating/T-12 Oct25-Sep26.xlsx', bytes: xlsx('month,rental_income\n2026-09,136900.00') },
    { path: 'Leases/Retail unit lease.pdf', bytes: new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog') },
    { path: '.DS_Store', bytes: new Uint8Array([0, 0, 0, 1]) },
  ];
}

export async function goodLease(): Promise<Uint8Array> {
  return (await writeLinesPdf(LEASE_LINES, { title: 'Retail unit lease' })).bytes;
}

const CATEGORIES: [RegExp, string][] = [
  [/Income statement/, 'INCOME_STATEMENT'],
  [/Balance sheet/, 'BALANCE_SHEET'],
  [/Operating statement/, 'INCOME_STATEMENT'],
  [/Rent roll/, 'MULTIFAMILY_RENT_ROLL'],
  [/T-12/, 'MULTIFAMILY_T12'],
  [/lease/i, 'LEASE'],
];

/** The AI gateway, scripted: classifies by file name; the vision lane reads the scan truly. Counts calls. */
export function scriptedAi(): RinseAiClient & { calls: number } {
  const client = {
    calls: 0,
    async classify(job: { fileName: string }): Promise<Classification> {
      client.calls += 1;
      const category = CATEGORIES.find(([pattern]) => pattern.test(job.fileName))?.[1] ?? 'OTHER';
      return { category, confidence: 0.95, promptVersion: 'document.classify@1' };
    },
    async readPages(): Promise<string[]> {
      client.calls += 1;
      return [OPERATING_SCAN_TRUE.join('\n')];
    },
  };
  return client;
}

export const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
