import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ArchiveError, isJunk, MAX_ARCHIVE_ENTRIES, unpackArchive } from './archive';

const zip = (files: Record<string, Uint8Array>) => zipSync(files, { level: 6 });

describe('unpackArchive (T-098)', () => {
  it('lists every supported file with its folder, skipping clutter', () => {
    const entries = unpackArchive(
      zip({
        '2 Financial/Balance sheet FY25.csv': strToU8('Line,Amount\nCash,100'),
        'Customers/Acme MSA.txt': strToU8('Master Subscription Agreement'),
        'notes.md': strToU8('# Notes'),
        '__MACOSX/Customers/._Acme MSA.txt': strToU8('x'),
        '.DS_Store': strToU8('x'),
        'Customers/~$Acme MSA.docx': strToU8('lock'),
      }),
    );
    expect(entries.map((entry) => entry.path)).toEqual([
      '2 Financial/Balance sheet FY25.csv',
      'Customers/Acme MSA.txt',
      'notes.md',
    ]);
    expect(entries[0]).toMatchObject({ kind: 'FILE', fileName: 'Balance sheet FY25.csv', folder: '2 Financial', contentType: 'text/csv' });
    expect(entries[2]).toMatchObject({ kind: 'FILE', folder: null, contentType: 'text/markdown' });
  });

  it('lists unsupported files as skipped, never drops them silently', () => {
    const entries = unpackArchive(zip({ 'deck.pptx': strToU8('x'), 'a.txt': strToU8('a') }));
    expect(entries).toContainEqual({ kind: 'SKIPPED', path: 'deck.pptx', reason: 'UNSUPPORTED_TYPE' });
  });

  it('unpacks a zip inside the zip once, and lists deeper ones as skipped', () => {
    const deepest = zip({ 'x.txt': strToU8('x') });
    const inner = zip({ 'Leases/Lease 4B.txt': strToU8('Lease'), 'older.zip': deepest });
    const entries = unpackArchive(zip({ 'Property.zip': inner }));
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'FILE', path: 'Property/Leases/Lease 4B.txt', folder: 'Property/Leases' }));
    expect(entries).toContainEqual({ kind: 'SKIPPED', path: 'Property/older.zip', reason: 'NESTED_TOO_DEEP' });
  });

  it('refuses archives that expand past the cap before inflating them', () => {
    const big = new Uint8Array(101 * 1024 * 1024);
    expect(() => unpackArchive(zip({ 'zeros.txt': big }))).toThrow(new ArchiveError('EXPANDS_TOO_FAR'));
  });

  it('refuses archives with too many files', () => {
    const files = Object.fromEntries(Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_, i) => [`f${i}.txt`, strToU8('x')]));
    expect(() => unpackArchive(zip(files))).toThrow(new ArchiveError('TOO_MANY_FILES'));
  });

  it('refuses bytes that are not a zip, and empty archives', () => {
    expect(() => unpackArchive(strToU8('not a zip at all'))).toThrow(new ArchiveError('NOT_A_ZIP'));
    expect(() => unpackArchive(zip({ '.DS_Store': strToU8('x') }))).toThrow(new ArchiveError('EMPTY'));
  });

  it('recognises clutter', () => {
    expect(isJunk('a/__MACOSX/b')).toBe(true);
    expect(isJunk('folder/')).toBe(true);
    expect(isJunk('Thumbs.db')).toBe(true);
    expect(isJunk('Rent roll.xlsx')).toBe(false);
  });
});
