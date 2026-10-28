import { unzipSync, type UnzipFileInfo } from 'fflate';
import { DOCX_CONTENT_TYPE, XLSX_CONTENT_TYPE, type AcceptedContentType } from './documents.types';

/**
 * Zip intake (T-098): one archive of a seller's files, unpacked on the server.
 * Bounded before anything is inflated — the declared sizes and the entry
 * count are checked first, so an archive cannot expand past the caps (zip
 * bombs). Every file inside then goes through the normal upload path (scan,
 * type check, page extraction), exactly like a direct upload.
 */
export const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 200;
export const MAX_ARCHIVE_EXPANDED_BYTES = 100 * 1024 * 1024;
/** A zip inside the zip is unpacked once; deeper nesting is listed and skipped. */
export const MAX_ARCHIVE_DEPTH = 2;

const CONTENT_TYPES: Readonly<Record<string, AcceptedContentType>> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  pdf: 'application/pdf',
  docx: DOCX_CONTENT_TYPE,
  xlsx: XLSX_CONTENT_TYPE,
};

export type ArchiveProblem = 'NOT_A_ZIP' | 'TOO_LARGE' | 'TOO_MANY_FILES' | 'EXPANDS_TOO_FAR' | 'EMPTY';

export class ArchiveError extends Error {
  constructor(readonly reason: ArchiveProblem) {
    super(`Archive rejected: ${reason}`);
    this.name = 'ArchiveError';
  }
}

export type ArchiveEntry =
  | {
      readonly kind: 'FILE';
      /** Path inside the archive, `/`-separated. */
      readonly path: string;
      readonly fileName: string;
      /** Folder inside the archive (a hint for the classifier), or null at the top. */
      readonly folder: string | null;
      readonly contentType: AcceptedContentType;
      readonly bytes: Uint8Array;
    }
  | {
      readonly kind: 'SKIPPED';
      readonly path: string;
      readonly reason: 'UNSUPPORTED_TYPE' | 'NESTED_TOO_DEEP';
    };

/** Operating-system clutter that is never a deal file. */
export function isJunk(path: string): boolean {
  const parts = path.split('/');
  const name = parts[parts.length - 1] ?? '';
  return (
    path.endsWith('/') ||
    parts.some((part) => part === '__MACOSX' || part === '.git') ||
    name === '.DS_Store' ||
    name === 'Thumbs.db' ||
    name === 'desktop.ini' ||
    name.startsWith('~$') ||
    name.startsWith('._')
  );
}

const extension = (name: string) => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '');

function split(path: string): { fileName: string; folder: string | null } {
  const parts = path.split('/').filter((part) => part.length > 0);
  const fileName = parts.pop() ?? path;
  return { fileName, folder: parts.length > 0 ? parts.join('/') : null };
}

interface Budget {
  entries: number;
  expanded: number;
}

function inflate(bytes: Uint8Array, budget: Budget): Record<string, Uint8Array> {
  const check = (file: UnzipFileInfo) => {
    if (isJunk(file.name)) return false;
    budget.entries += 1;
    budget.expanded += file.originalSize;
    if (budget.entries > MAX_ARCHIVE_ENTRIES) throw new ArchiveError('TOO_MANY_FILES');
    if (budget.expanded > MAX_ARCHIVE_EXPANDED_BYTES) throw new ArchiveError('EXPANDS_TOO_FAR');
    return true;
  };
  try {
    return unzipSync(bytes, { filter: check });
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError('NOT_A_ZIP');
  }
}

function walk(bytes: Uint8Array, prefix: string, depth: number, budget: Budget): ArchiveEntry[] {
  const files = inflate(bytes, budget);
  return Object.keys(files)
    .sort()
    .flatMap((name): ArchiveEntry[] => {
      const path = prefix ? `${prefix}/${name}` : name;
      const content = files[name] as Uint8Array;
      const ext = extension(name);
      if (ext === 'zip') {
        if (depth >= MAX_ARCHIVE_DEPTH) return [{ kind: 'SKIPPED', path, reason: 'NESTED_TOO_DEEP' }];
        // The inner archive's folder becomes part of each file's path.
        return walk(content, path.replace(/\.zip$/i, ''), depth + 1, budget);
      }
      const contentType = CONTENT_TYPES[ext];
      if (!contentType) return [{ kind: 'SKIPPED', path, reason: 'UNSUPPORTED_TYPE' }];
      return [{ kind: 'FILE', path, ...split(path), contentType, bytes: content }];
    });
}

/** Unpack an archive into the files to upload and the ones skipped, each with its reason. */
export function unpackArchive(bytes: Uint8Array): ArchiveEntry[] {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new ArchiveError('TOO_LARGE');
  const entries = walk(bytes, '', 1, { entries: 0, expanded: 0 });
  if (entries.length === 0) throw new ArchiveError('EMPTY');
  return entries;
}
