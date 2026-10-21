import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentPages } from '../documents/document-text';
import { DOCX_CONTENT_TYPE } from '../documents/documents.types';
import { SignatureMalwareScanner, validateUpload } from '../documents/upload-policy';

const generated = new URL('../../../../fixtures/test-kit/FreshCo/generated/', import.meta.url).pathname;
const TYPES: Record<string, string> = { pdf: 'application/pdf', docx: DOCX_CONTENT_TYPE, txt: 'text/plain' };

describe('FreshCo test kit documents', () => {
  const files = readdirSync(generated).filter((name) => /\.(pdf|docx|txt)$/.test(name));

  it('has every document in PDF, Word and text form', () => {
    expect(files).toHaveLength(12);
  });

  it('passes the upload policy and extracts with real PDF page numbers', async () => {
    for (const fileName of files) {
      const bytes = readFileSync(join(generated, fileName));
      const contentType = TYPES[fileName.split('.').pop() ?? ''] ?? '';
      const upload = await validateUpload({ fileName, contentType, contentBase64: bytes.toString('base64') }, new SignatureMalwareScanner());
      const pages = await documentPages(upload);
      expect(pages.length, fileName).toBeGreaterThan(0);
    }
    const balance = await documentPages({ contentType: 'application/pdf', bytes: readFileSync(join(generated, '03-balance-sheet-2026-09-30.pdf')), text: null });
    // Quotes a person pastes as balance-sheet item citations are on page 2.
    expect(balance[1]?.text).toContain('Term loan with Lakeside Bank, outstanding principal: USD 450,000');
    expect(balance[1]?.text).toContain('Deferred revenue on annual subscriptions billed in advance: USD 96,000');
  });
});
