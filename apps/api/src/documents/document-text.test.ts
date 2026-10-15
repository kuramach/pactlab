import { describe, expect, it } from 'vitest';
import { documentPages } from './document-text';
import { DOCX_CONTENT_TYPE } from './documents.types';
import { ExtractionError } from './extraction';
import { syntheticDocx, syntheticPdf } from './synthetic-files';
import type { UploadRejectedError} from './upload-policy';
import { SignatureMalwareScanner, validateUpload } from './upload-policy';

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const scanner = new SignatureMalwareScanner();

describe('PDF and Word text extraction', () => {
  it('keeps real PDF page numbers', async () => {
    const pdf = syntheticPdf([
      ['Master Services Agreement (synthetic)', 'Between Example Buyer and Example Target.'],
      ['Clause 7. Change of control: either party may terminate on a change of control.'],
    ]);
    const pages = await documentPages({ contentType: 'application/pdf', bytes: pdf, text: null });
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(pages[1]?.text).toContain('Clause 7. Change of control: either party may terminate on a change of control.');
    expect(pages[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a PDF with no text layer and an unreadable one', async () => {
    await expect(documentPages({ contentType: 'application/pdf', bytes: syntheticPdf([[], []]), text: null })).rejects.toMatchObject({ reason: 'NEEDS_OCR' });
    const broken = new Uint8Array(Buffer.from('%PDF-1.4\nthis is not a PDF body', 'latin1'));
    await expect(documentPages({ contentType: 'application/pdf', bytes: broken, text: null })).rejects.toBeInstanceOf(ExtractionError);
  });

  it('reads Word paragraphs into sections', async () => {
    const docx = syntheticDocx(['Loan agreement (synthetic)', 'Principal outstanding: USD 120,000.', 'Repayable on a change of control.']);
    const pages = await documentPages({ contentType: DOCX_CONTENT_TYPE, bytes: docx, text: null });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toContain('Principal outstanding: USD 120,000.');
    await expect(documentPages({ contentType: DOCX_CONTENT_TYPE, bytes: new Uint8Array(Buffer.from('PK\u0003\u0004 not a zip')), text: null })).rejects.toMatchObject({
      reason: 'UNREADABLE',
    });
  });
});

describe('upload policy for PDF and Word', () => {
  it('accepts PDF and docx that carry their own signature', async () => {
    const pdf = await validateUpload({ fileName: 'msa.pdf', contentType: 'application/pdf', contentBase64: base64(syntheticPdf([['Synthetic text']])) }, scanner);
    expect(pdf).toMatchObject({ contentType: 'application/pdf', text: null });
    const docx = await validateUpload({ fileName: 'loan.docx', contentType: DOCX_CONTENT_TYPE, contentBase64: base64(syntheticDocx(['Synthetic'])) }, scanner);
    expect(docx.contentType).toBe(DOCX_CONTENT_TYPE);
  });

  it('refuses mismatched signatures, wrong extensions, executables and legacy .doc', async () => {
    const reject = (input: { fileName: string; contentType: string; contentBase64: string }) =>
      validateUpload(input, scanner).catch((error: unknown) => (error as UploadRejectedError).reason);
    expect(await reject({ fileName: 'msa.pdf', contentType: 'application/pdf', contentBase64: base64(syntheticDocx(['x'])) })).toBe('TYPE_MISMATCH');
    expect(await reject({ fileName: 'msa.pdf', contentType: 'application/pdf', contentBase64: base64(new Uint8Array(Buffer.from('MZ executable'))) })).toBe('TYPE_MISMATCH');
    expect(await reject({ fileName: 'msa.txt', contentType: 'application/pdf', contentBase64: base64(syntheticPdf([['x']])) })).toBe('TYPE_MISMATCH');
    expect(await reject({ fileName: 'old.doc', contentType: 'application/msword', contentBase64: base64(new Uint8Array([1])) })).toBe('UNSUPPORTED_TYPE');
    expect(await reject({ fileName: 'notes.txt', contentType: 'text/plain', contentBase64: base64(syntheticPdf([['x']])) })).toBe('TYPE_MISMATCH');
  });

  it('allows 10 MB for PDF and Word, still 512 KB for text', async () => {
    const big = new Uint8Array(600 * 1024).fill(0x41);
    expect(await validateUpload({ fileName: 'big.txt', contentType: 'text/plain', contentBase64: base64(big) }, scanner).catch((error: unknown) => (error as UploadRejectedError).reason)).toBe('TOO_LARGE');
    const pdfHead = new Uint8Array(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024)]));
    expect(await validateUpload({ fileName: 'huge.pdf', contentType: 'application/pdf', contentBase64: base64(pdfHead) }, scanner).catch((error: unknown) => (error as UploadRejectedError).reason)).toBe('TOO_LARGE');
  });
});
