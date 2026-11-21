import { z } from 'zod';
import type { ConnectionMode } from '../contract';

/**
 * Document sources (T-098, ADR 0016): a data room or drive folder the deal
 * already uses. Pactlab reads from it — it never writes, moves or shares
 * files at the source, and it is not a data room itself. Each file is pulled
 * through the normal upload path (scan, pages, retention) and then intake.
 */
export const DOCUMENT_SOURCE_PROVIDERS = ['google-drive', 'onedrive', 'vdr'] as const;
export type DocumentSourceProvider = (typeof DOCUMENT_SOURCE_PROVIDERS)[number];

export const DOCUMENT_SOURCE_LABELS: Readonly<Record<DocumentSourceProvider, string>> = {
  'google-drive': 'Google Drive',
  onedrive: 'OneDrive / SharePoint',
  vdr: 'Virtual data room',
};

/**
 * Read-only access each live provider needs, verified against the providers'
 * documentation (ADR 0016): Drive `files.list` + `files.get?alt=media`;
 * Graph `driveItem` children + `/content`.
 */
export const DOCUMENT_SOURCE_SCOPES: Readonly<Record<DocumentSourceProvider, readonly string[]>> = {
  'google-drive': ['https://www.googleapis.com/auth/drive.readonly'],
  onedrive: ['Files.Read.All (delegated)', 'offline_access', 'User.Read'],
  vdr: [],
};

/** Non-secret settings: which folder (or fixture room) to read. */
export const documentSourceConfigSchema = z.strictObject({
  /** Fixture room id, Drive folder id, or `<drive-id>/<item-id>` for OneDrive/SharePoint. */
  folder: z.string().trim().regex(/^[A-Za-z0-9!_.:/-]{1,300}$/),
});
export type DocumentSourceConfig = z.infer<typeof documentSourceConfigSchema>;

/** One file at the source. Metadata only; bytes are read one file at a time. */
export interface SourceFile {
  readonly externalId: string;
  /** Folder path inside the room, `/`-separated, without the file name; '' at the top. */
  readonly folder: string;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number | null;
  /** Changes whenever the file's content changes (Drive version, Graph cTag, fixture version). */
  readonly version: string;
  /** Native documents (Google Docs and Sheets) are exported as this type instead of downloaded. */
  readonly exportAs?: string;
}

export class DocumentSourceError extends Error {
  constructor(readonly reason: 'NOT_FOUND' | 'ACCESS' | 'UNAVAILABLE' | 'TOO_LARGE' | 'NOT_CONFIGURED') {
    super(`Document source: ${reason}`);
    this.name = 'DocumentSourceError';
  }
}

/**
 * Most files listed per sync (names and versions only, which is cheap). Adapters return one entry
 * more when there are more, so a sync can tell a listing was cut short and say so (T-126).
 */
export const MAX_SOURCE_FILES = 20_000;
/** Most new or changed files read per sync; the rest wait for the next sync, which carries on (T-126). */
export const MAX_SOURCE_READS = 200;
/** Largest file read from a source (the upload limit for PDF, Word and Excel). */
export const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;

export interface DocumentSourceScope {
  /** A pasted access token in the secret store (sources connected before T-147). */
  readonly credentialRef: string | null;
  /** The organization's OAuth connection (T-147): a fresh access token on each call. Wins over `credentialRef`. */
  readonly accessToken?: (() => Promise<string>) | undefined;
}

export interface DocumentSourceAdapter {
  readonly provider: DocumentSourceProvider;
  readonly mode: ConnectionMode;
  /** Every file under the folder, recursively, up to MAX_SOURCE_FILES + 1 (the extra one says there are more). */
  list(scope: DocumentSourceScope, config: DocumentSourceConfig): Promise<SourceFile[]>;
  read(scope: DocumentSourceScope, config: DocumentSourceConfig, file: SourceFile): Promise<Uint8Array>;
}
