/**
 * Pactlab Rinse (T-178, ADR 0058): what each file in the seller's set is, read from its bytes, never
 * trusted from its name. Corruption, duplicates and readability are deterministic: they cost no model
 * call and run offline.
 */

export type RinseFileKind = 'PDF' | 'WORD' | 'SPREADSHEET' | 'CSV' | 'PRESENTATION' | 'IMAGE' | 'TEXT' | 'ARCHIVE' | 'UNSUPPORTED';

/**
 * What the rinse does with a kind of file. Documents become the canonical form (normalized PDF with a
 * text layer and stable page anchors). Spreadsheets and statements are never flattened: they travel as
 * they are, flagged for guided import (T-152) at injection. Archives are unpacked.
 */
export type RinseRoute = 'CONVERT' | 'GUIDED_IMPORT' | 'UNPACK' | 'NONE';

export const RINSE_ROUTES: Readonly<Record<RinseFileKind, RinseRoute>> = {
  PDF: 'CONVERT',
  WORD: 'CONVERT',
  PRESENTATION: 'CONVERT',
  IMAGE: 'CONVERT',
  TEXT: 'CONVERT',
  SPREADSHEET: 'GUIDED_IMPORT',
  CSV: 'GUIDED_IMPORT',
  ARCHIVE: 'UNPACK',
  UNSUPPORTED: 'NONE',
} satisfies Record<RinseFileKind, RinseRoute>;

const EXTENSIONS: Readonly<Record<string, RinseFileKind>> = {
  pdf: 'PDF',
  docx: 'WORD',
  doc: 'WORD',
  xlsx: 'SPREADSHEET',
  xls: 'SPREADSHEET',
  csv: 'CSV',
  tsv: 'CSV',
  pptx: 'PRESENTATION',
  ppt: 'PRESENTATION',
  png: 'IMAGE',
  jpg: 'IMAGE',
  jpeg: 'IMAGE',
  tif: 'IMAGE',
  tiff: 'IMAGE',
  txt: 'TEXT',
  md: 'TEXT',
  zip: 'ARCHIVE',
};

/** Operating-system clutter, skipped silently (as zip intake does). */
export function isClutter(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  return name.startsWith('.') || name.startsWith('~$') || name === 'Thumbs.db' || path.split('/').includes('__MACOSX');
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function tail(bytes: Uint8Array, length: number): string {
  return new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - length)));
}

export interface FileInspection {
  readonly kind: RinseFileKind;
  readonly route: RinseRoute;
  /** Null when the bytes are what the name says; otherwise why the file cannot be read. */
  readonly corrupt: null | 'EMPTY' | 'SIGNATURE_MISMATCH' | 'TRUNCATED' | 'LEGACY_FORMAT';
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];

/** Inspect a file's bytes against its name. Legacy Office files need re-saving, as uploads do (ADR 0037). */
export function inspectFile(name: string, bytes: Uint8Array): FileInspection {
  const kind = EXTENSIONS[extensionOf(name)] ?? 'UNSUPPORTED';
  const route = RINSE_ROUTES[kind];
  const result = (corrupt: FileInspection['corrupt']): FileInspection => ({ kind, route, corrupt });
  if (kind === 'UNSUPPORTED') return result(null);
  if (bytes.length === 0) return result('EMPTY');
  const extension = extensionOf(name);
  switch (kind) {
    case 'PDF':
      if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return result('SIGNATURE_MISMATCH');
      return tail(bytes, 1024).includes('%%EOF') ? result(null) : result('TRUNCATED');
    case 'WORD':
    case 'SPREADSHEET':
    case 'PRESENTATION':
      if (['doc', 'xls', 'ppt'].includes(extension)) return result(startsWith(bytes, OLE) ? 'LEGACY_FORMAT' : 'SIGNATURE_MISMATCH');
      return startsWith(bytes, ZIP) ? result(null) : result('SIGNATURE_MISMATCH');
    case 'ARCHIVE':
      return startsWith(bytes, ZIP) ? result(null) : result('SIGNATURE_MISMATCH');
    case 'IMAGE':
      if (extension === 'png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) ? result(null) : result('SIGNATURE_MISMATCH');
      if (extension === 'jpg' || extension === 'jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff]) ? result(null) : result('SIGNATURE_MISMATCH');
      return startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]) ? result(null) : result('SIGNATURE_MISMATCH');
    case 'TEXT':
    case 'CSV': {
      // Text must decode as UTF-8; a NUL byte means it is not text at all.
      if (bytes.includes(0)) return result('SIGNATURE_MISMATCH');
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return result(null);
      } catch {
        return result('SIGNATURE_MISMATCH');
      }
    }
  }
}

/** Words of a text, lower-cased, for near-duplicate comparison. */
function shingles(text: string, size = 5): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set<string>();
  if (words.length < size) {
    if (words.length > 0) out.add(words.join(' '));
    return out;
  }
  for (let index = 0; index + size <= words.length; index += 1) out.add(words.slice(index, index + size).join(' '));
  return out;
}

/** Jaccard similarity of two texts' five-word shingles, 0 to 1. */
export function textSimilarity(a: string, b: string): number {
  const left = shingles(a);
  const right = shingles(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const shingle of left) if (right.has(shingle)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Two documents whose text is at least this similar are flagged as near duplicates for the seller. */
export const NEAR_DUPLICATE_SIMILARITY = 0.9;

export interface DuplicateCandidate {
  readonly id: string;
  readonly sha256: string;
  /** Extracted text, when the file has been read; near duplicates are found only among read files. */
  readonly text?: string | null;
}

export interface DuplicateMatch {
  readonly id: string;
  readonly of: string;
  readonly kind: 'EXACT' | 'NEAR';
  readonly similarity: number;
}

/**
 * Exact duplicates share a SHA-256; near duplicates share most of their text (a re-saved or re-exported
 * copy). The first file in the given order is kept as the original of each group.
 */
export function findDuplicates(files: readonly DuplicateCandidate[]): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const firstByHash = new Map<string, string>();
  const kept: DuplicateCandidate[] = [];
  for (const file of files) {
    const original = firstByHash.get(file.sha256);
    if (original) {
      matches.push({ id: file.id, of: original, kind: 'EXACT', similarity: 1 });
      continue;
    }
    firstByHash.set(file.sha256, file.id);
    if (file.text) {
      const near = kept.find((other) => other.text && textSimilarity(other.text, file.text ?? '') >= NEAR_DUPLICATE_SIMILARITY);
      if (near) {
        matches.push({ id: file.id, of: near.id, kind: 'NEAR', similarity: Math.round(textSimilarity(near.text ?? '', file.text) * 1000) / 1000 });
        continue;
      }
    }
    kept.push(file);
  }
  return matches;
}

/** A page with fewer readable characters than this has no usable text layer: it is read from its image. */
export const MIN_PAGE_TEXT_CHARS = 40;

/** Pages whose text layer is too thin to read: they need the vision lane (online) or a re-scan. */
export function unreadablePages(pageTexts: readonly string[]): number[] {
  return pageTexts.flatMap((text, index) => ((text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < MIN_PAGE_TEXT_CHARS ? [index + 1] : []));
}
