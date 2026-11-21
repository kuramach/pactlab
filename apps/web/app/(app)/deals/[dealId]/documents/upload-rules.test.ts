import { describe, expect, it } from 'vitest';
import { checkFile, guessDataClass, UPLOAD_PROBLEMS } from './upload-rules';

describe('document upload rules', () => {
  it('accepts the supported types within their limits', () => {
    expect(checkFile('01-msa.pdf', 200_000)).toEqual({ contentType: 'application/pdf' });
    expect(checkFile('notes.MD', 1_000)).toEqual({ contentType: 'text/markdown' });
    expect(checkFile('Data room.ZIP', 9 * 1024 * 1024)).toEqual({ contentType: 'application/zip' });
  });

  it('names the problem for empty, unsupported and oversized files', () => {
    expect(checkFile('empty.pdf', 0)).toEqual({ problem: 'no-file' });
    expect(checkFile('old.xls', 1_000)).toEqual({ problem: 'type' });
    expect(checkFile('big.txt', 600 * 1024)).toEqual({ problem: 'too-large' });
    expect(checkFile('big.pdf', 11 * 1024 * 1024)).toEqual({ problem: 'too-large' });
    expect(checkFile('big.zip', 11 * 1024 * 1024)).toEqual({ problem: 'too-large' });
  });

  it('defaults financial-looking files to financial information', () => {
    expect(guessDataClass('03-balance-sheet-2026-09-30.pdf')).toBe('FINANCIAL');
    expect(guessDataClass('99-data-room-extracts.pdf')).toBe('FINANCIAL');
    expect(guessDataClass('02-master-services-agreement-northgate.pdf')).toBe('BUSINESS');
  });
});

describe('PowerPoint and images (T-121)', () => {
  it('accepts decks and images as binary files up to 10 MB; old Office formats are asked to be resaved', () => {
    expect(checkFile('Board deck.pptx', 2_000_000)).toEqual({ contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    expect(checkFile('Scan.PNG', 2_000_000)).toEqual({ contentType: 'image/png' });
    expect(checkFile('Photo.jpeg', 2_000_000)).toEqual({ contentType: 'image/jpeg' });
    expect(checkFile('Photo.jpg', 11 * 1024 * 1024)).toEqual({ problem: 'too-large' });
    expect(checkFile('Old deck.ppt', 1_000)).toEqual({ problem: 'type' });
    expect(UPLOAD_PROBLEMS.type).toContain('save them as .docx, .xlsx or .pptx');
  });
});
