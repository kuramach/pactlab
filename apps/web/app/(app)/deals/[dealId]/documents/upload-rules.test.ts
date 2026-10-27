import { describe, expect, it } from 'vitest';
import { checkFile, guessDataClass } from './upload-rules';

describe('document upload rules', () => {
  it('accepts the supported types within their limits', () => {
    expect(checkFile('01-msa.pdf', 200_000)).toEqual({ contentType: 'application/pdf' });
    expect(checkFile('notes.MD', 1_000)).toEqual({ contentType: 'text/markdown' });
  });

  it('names the problem for empty, unsupported and oversized files', () => {
    expect(checkFile('empty.pdf', 0)).toEqual({ problem: 'no-file' });
    expect(checkFile('old.xls', 1_000)).toEqual({ problem: 'type' });
    expect(checkFile('big.txt', 600 * 1024)).toEqual({ problem: 'too-large' });
    expect(checkFile('big.pdf', 11 * 1024 * 1024)).toEqual({ problem: 'too-large' });
  });

  it('defaults financial-looking files to financial information', () => {
    expect(guessDataClass('03-balance-sheet-2026-09-30.pdf')).toBe('FINANCIAL');
    expect(guessDataClass('99-data-room-extracts.pdf')).toBe('FINANCIAL');
    expect(guessDataClass('02-master-services-agreement-northgate.pdf')).toBe('BUSINESS');
  });
});
