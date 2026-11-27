import { createHash } from 'node:crypto';
import { parseRinseManifest, RINSE_MANIFEST_FILE, type RinseManifest, type RinseManifestDocument } from '@pactlab/contracts';
import type { DocumentSourceAdapter, DocumentSourceConfig, DocumentSourceScope, SourceFile } from './types';

/**
 * A folder finished by Pactlab Rinse (T-178, ADR 0058) carries `pactlab-manifest.json` at its top. The
 * pact reads it at sync time, so classifications, gap notes, audit results and provenance arrive with
 * the files. The manifest is untrusted: it is schema-checked, and every file is matched to its entry by
 * path and SHA-256 before anything in the entry is used.
 */
export type RinseFileRole =
  /** The canonical (converted or generated) copy of a document: the one the pact reads and cites. */
  | 'CONVERTED'
  /** The seller's original, kept at the source beside its canonical copy. */
  | 'ORIGINAL'
  /** A spreadsheet or statement carried as it is, for guided import. */
  | 'AS_IS';

export interface RinseFileMatch {
  readonly document: RinseManifestDocument;
  readonly role: RinseFileRole;
  readonly sha256: string;
}

export type RinsedFolder =
  | { readonly status: 'NONE' }
  | { readonly status: 'INVALID'; readonly problem: 'TOO_LARGE' | 'NOT_JSON' | 'INVALID' | 'UNREADABLE' }
  | { readonly status: 'READ'; readonly manifest: RinseManifest; readonly manifestFile: SourceFile; readonly byPath: ReadonlyMap<string, RinseFileMatch>; readonly manifestSha256: string };

export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function sourcePathOf(file: Pick<SourceFile, 'folder' | 'name'>): string {
  return file.folder ? `${file.folder}/${file.name}` : file.name;
}

/** Index a manifest's files by path: each document's canonical copy, its original, or the file itself. */
export function indexRinseManifest(manifest: RinseManifest): Map<string, RinseFileMatch> {
  const byPath = new Map<string, RinseFileMatch>();
  for (const document of manifest.documents) {
    if (document.converted) byPath.set(document.converted.path, { document, role: 'CONVERTED', sha256: document.converted.sha256 });
    if (document.original) byPath.set(document.original.path, { document, role: document.converted ? 'ORIGINAL' : 'AS_IS', sha256: document.original.sha256 });
  }
  return byPath;
}

/** Find and read the manifest at the top of a listing; NONE when the folder was not rinsed. */
export async function readRinsedFolder(adapter: DocumentSourceAdapter, scope: DocumentSourceScope, config: DocumentSourceConfig, listing: readonly SourceFile[]): Promise<RinsedFolder> {
  const manifestFile = listing.find((file) => file.folder === '' && file.name === RINSE_MANIFEST_FILE);
  if (!manifestFile) return { status: 'NONE' };
  let bytes: Uint8Array;
  try {
    bytes = await adapter.read(scope, config, manifestFile);
  } catch {
    return { status: 'INVALID', problem: 'UNREADABLE' };
  }
  return rinsedFolderOf(manifestFile, bytes);
}

function rinsedFolderOf(manifestFile: SourceFile, bytes: Uint8Array): RinsedFolder {
  const parsed = parseRinseManifest(bytes);
  if (!parsed.manifest) return { status: 'INVALID', problem: parsed.problem };
  return { status: 'READ', manifest: parsed.manifest, manifestFile, byPath: indexRinseManifest(parsed.manifest), manifestSha256: sha256Hex(bytes) };
}

/** A file of a one-time archive import (T-178d), by its path inside the set. */
export interface RinseArchiveFile {
  readonly folder: string;
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * Injection path (b), T-178d: a rinsed folder uploaded once as a zip. The same manifest reader and the
 * same SHA-256 checks as the sync. A zip of the folder itself often wraps everything in one top folder:
 * when the manifest sits there and nothing lies outside it, that folder is the set's root.
 */
export function readRinsedArchive(entries: readonly { readonly path: string; readonly bytes: Uint8Array }[]): { folder: RinsedFolder; files: RinseArchiveFile[] } {
  const tops = new Set(entries.map((entry) => entry.path.split('/')[0] ?? ''));
  const wrapper = !entries.some((entry) => entry.path === RINSE_MANIFEST_FILE) && tops.size === 1 && entries.some((entry) => entry.path === `${[...tops][0]}/${RINSE_MANIFEST_FILE}`) ? `${[...tops][0]}/` : '';
  const files = entries.map((entry) => {
    const path = entry.path.slice(wrapper.length);
    const cut = path.lastIndexOf('/');
    return { folder: cut === -1 ? '' : path.slice(0, cut), name: cut === -1 ? path : path.slice(cut + 1), bytes: entry.bytes };
  });
  const manifest = files.find((file) => file.folder === '' && file.name === RINSE_MANIFEST_FILE);
  if (!manifest) return { folder: { status: 'NONE' }, files };
  const manifestFile: SourceFile = { externalId: RINSE_MANIFEST_FILE, folder: '', name: RINSE_MANIFEST_FILE, mediaType: 'application/json', sizeBytes: manifest.bytes.byteLength, version: '1' };
  return { folder: rinsedFolderOf(manifestFile, manifest.bytes), files };
}

/** What happens to one listed file of a folder that carries a manifest (shared by the sync and the archive import). */
export type RinseDisposition =
  /** No manifest was read: an ordinary folder. */
  | { readonly kind: 'ORDINARY' }
  /** The manifest itself: read for provenance, never kept as a document. */
  | { readonly kind: 'MANIFEST' }
  /** Nothing half-clean comes in: a file the manifest does not name was added after the rinse. */
  | { readonly kind: 'REFUSE'; readonly reason: 'NOT_IN_RINSE_MANIFEST' }
  /** The original stays at the source, named in its copy's provenance; a hand entry becomes a claim. */
  | { readonly kind: 'SKIP'; readonly reason: 'RINSE_ORIGINAL' | 'HAND_SOURCED_CLAIM' }
  /** Read it: a canonical copy, or a file carried as it is. Its bytes are still matched by SHA-256. */
  | { readonly kind: 'READ'; readonly match: RinseFileMatch };

export function rinseDisposition(folder: RinsedFolder, file: Pick<SourceFile, 'folder' | 'name'>): RinseDisposition {
  if (folder.status === 'NONE') return { kind: 'ORDINARY' };
  if (file.folder === '' && file.name === RINSE_MANIFEST_FILE) return { kind: 'MANIFEST' };
  if (folder.status === 'INVALID') return { kind: 'ORDINARY' };
  const match = folder.byPath.get(sourcePathOf(file));
  if (!match) return { kind: 'REFUSE', reason: 'NOT_IN_RINSE_MANIFEST' };
  if (match.role === 'ORIGINAL') return { kind: 'SKIP', reason: 'RINSE_ORIGINAL' };
  if (match.document.source === 'HAND_ENTRY') return { kind: 'SKIP', reason: 'HAND_SOURCED_CLAIM' };
  return { kind: 'READ', match };
}

/** Whether a file read from the folder is exactly the file the manifest describes. */
export function matchRinsedFile(folder: RinsedFolder, file: Pick<SourceFile, 'folder' | 'name'>, bytes: Uint8Array): RinseFileMatch | 'NOT_IN_MANIFEST' | 'CHANGED_SINCE_RINSE' | null {
  if (folder.status !== 'READ') return null;
  const match = folder.byPath.get(sourcePathOf(file));
  if (!match) return 'NOT_IN_MANIFEST';
  return sha256Hex(bytes) === match.sha256 ? match : 'CHANGED_SINCE_RINSE';
}
