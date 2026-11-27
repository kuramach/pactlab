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
  | { readonly status: 'READ'; readonly manifest: RinseManifest; readonly manifestFile: SourceFile; readonly byPath: ReadonlyMap<string, RinseFileMatch> };

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
  const parsed = parseRinseManifest(bytes);
  if (!parsed.manifest) return { status: 'INVALID', problem: parsed.problem };
  return { status: 'READ', manifest: parsed.manifest, manifestFile, byPath: indexRinseManifest(parsed.manifest) };
}

/** Whether a file read from the folder is exactly the file the manifest describes. */
export function matchRinsedFile(folder: RinsedFolder, file: Pick<SourceFile, 'folder' | 'name'>, bytes: Uint8Array): RinseFileMatch | 'NOT_IN_MANIFEST' | 'CHANGED_SINCE_RINSE' | null {
  if (folder.status !== 'READ') return null;
  const match = folder.byPath.get(sourcePathOf(file));
  if (!match) return 'NOT_IN_MANIFEST';
  return sha256Hex(bytes) === match.sha256 ? match : 'CHANGED_SINCE_RINSE';
}
