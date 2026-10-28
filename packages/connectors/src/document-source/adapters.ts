import type { SecretStore } from '../credentials';
import type { FetchLike } from '../http/cassette';
import { FIXTURE_ROOMS, type FixtureRoom } from './fixture-rooms';
import {
  DocumentSourceError,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
  type DocumentSourceAdapter,
  type DocumentSourceConfig,
  type DocumentSourceProvider,
  type DocumentSourceScope,
  type SourceFile,
} from './types';

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const mediaTypeOf = (name: string) => MEDIA_TYPES[(name.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream';

/** Synthetic rooms behind the same interface as a live drive (fixture-first). */
export class FixtureDocumentSourceAdapter implements DocumentSourceAdapter {
  readonly mode = 'FIXTURE' as const;

  constructor(
    readonly provider: DocumentSourceProvider,
    private readonly rooms: Readonly<Record<string, FixtureRoom>> = FIXTURE_ROOMS,
  ) {}

  private room(config: DocumentSourceConfig): FixtureRoom {
    const room = this.rooms[config.folder];
    if (!room) throw new DocumentSourceError('NOT_FOUND');
    return room;
  }

  async list(_scope: DocumentSourceScope, config: DocumentSourceConfig): Promise<SourceFile[]> {
    return this.room(config).files.slice(0, MAX_SOURCE_FILES).map((file) => ({
      externalId: `${config.folder}:${file.folder}/${file.name}`,
      folder: file.folder,
      name: file.name,
      mediaType: mediaTypeOf(file.name),
      sizeBytes: Buffer.byteLength(file.text),
      version: String(file.version),
    }));
  }

  async read(_scope: DocumentSourceScope, config: DocumentSourceConfig, file: SourceFile): Promise<Uint8Array> {
    const found = this.room(config).files.find((entry) => `${config.folder}:${entry.folder}/${entry.name}` === file.externalId);
    if (!found) throw new DocumentSourceError('NOT_FOUND');
    return new TextEncoder().encode(found.text);
  }
}

function failure(status: number): DocumentSourceError {
  if (status === 401 || status === 403) return new DocumentSourceError('ACCESS');
  if (status === 404) return new DocumentSourceError('NOT_FOUND');
  return new DocumentSourceError('UNAVAILABLE');
}

async function bearer(secrets: SecretStore, scope: DocumentSourceScope): Promise<string> {
  if (!scope.credentialRef) throw new DocumentSourceError('ACCESS');
  try {
    return await secrets.get(scope.credentialRef);
  } catch {
    throw new DocumentSourceError('ACCESS');
  }
}

async function bounded(response: Response): Promise<Uint8Array> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_SOURCE_FILE_BYTES) throw new DocumentSourceError('TOO_LARGE');
  return bytes;
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_FOLDER = 'application/vnd.google-apps.folder';
/** Google Docs and Sheets have no file to download; they are exported (≤ 10 MB) as Word and Excel. */
const DRIVE_EXPORTS: Readonly<Record<string, { mimeType: string; extension: string }>> = {
  'application/vnd.google-apps.document': { mimeType: MEDIA_TYPES['docx'] as string, extension: 'docx' },
  'application/vnd.google-apps.spreadsheet': { mimeType: MEDIA_TYPES['xlsx'] as string, extension: 'xlsx' },
};

interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size?: string;
  readonly version?: string;
}

/**
 * Google Drive, read-only (`drive.readonly`): `files.list` under the folder,
 * recursively, and `files.get?alt=media` (or `files.export` for Docs and
 * Sheets) for each file. Shared drives included.
 */
export class GoogleDriveDocumentSourceAdapter implements DocumentSourceAdapter {
  readonly provider = 'google-drive' as const;
  readonly mode = 'LIVE' as const;

  constructor(private readonly deps: { readonly fetch: FetchLike; readonly secrets: SecretStore }) {}

  private async get(token: string, url: string): Promise<Response> {
    const response = await this.deps.fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw failure(response.status);
    return response;
  }

  async list(scope: DocumentSourceScope, config: DocumentSourceConfig): Promise<SourceFile[]> {
    const token = await bearer(this.deps.secrets, scope);
    const files: SourceFile[] = [];
    const queue: { id: string; path: string }[] = [{ id: config.folder, path: '' }];
    while (queue.length > 0 && files.length < MAX_SOURCE_FILES) {
      const folder = queue.shift() as { id: string; path: string };
      let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({
          q: `'${folder.id.replaceAll("'", "\\'")}' in parents and trashed = false`,
          fields: 'nextPageToken,files(id,name,mimeType,size,version)',
          pageSize: '1000',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
          ...(pageToken ? { pageToken } : {}),
        });
        const page = (await (await this.get(token, `${DRIVE}?${query.toString()}`)).json()) as { files?: DriveFile[]; nextPageToken?: string };
        for (const file of page.files ?? []) {
          if (file.mimeType === DRIVE_FOLDER) {
            queue.push({ id: file.id, path: folder.path ? `${folder.path}/${file.name}` : file.name });
            continue;
          }
          const exported = DRIVE_EXPORTS[file.mimeType];
          files.push({
            externalId: file.id,
            folder: folder.path,
            name: exported && !file.name.toLowerCase().endsWith(`.${exported.extension}`) ? `${file.name}.${exported.extension}` : file.name,
            mediaType: exported?.mimeType ?? file.mimeType,
            sizeBytes: file.size ? Number(file.size) : null,
            version: file.version ?? '0',
            ...(exported ? { exportAs: exported.mimeType } : {}),
          });
        }
        pageToken = page.nextPageToken;
      } while (pageToken && files.length < MAX_SOURCE_FILES);
    }
    return files.slice(0, MAX_SOURCE_FILES);
  }

  async read(scope: DocumentSourceScope, _config: DocumentSourceConfig, file: SourceFile): Promise<Uint8Array> {
    if (file.sizeBytes !== null && file.sizeBytes > MAX_SOURCE_FILE_BYTES) throw new DocumentSourceError('TOO_LARGE');
    const token = await bearer(this.deps.secrets, scope);
    const id = encodeURIComponent(file.externalId);
    const url = file.exportAs
      ? `${DRIVE}/${id}/export?${new URLSearchParams({ mimeType: file.exportAs }).toString()}`
      : `${DRIVE}/${id}?alt=media&supportsAllDrives=true`;
    return bounded(await this.get(token, url));
  }
}

const GRAPH = 'https://graph.microsoft.com/v1.0';

interface GraphItem {
  readonly id: string;
  readonly name: string;
  readonly size?: number;
  readonly cTag?: string;
  readonly file?: { readonly mimeType?: string };
  readonly folder?: object;
}

/**
 * OneDrive and SharePoint through Microsoft Graph, read-only (`Files.Read` /
 * `Files.Read.All`): driveItem children, recursively, and `/content`, whose
 * 302 points at a pre-authenticated URL that is fetched without the token.
 * Config `folder` is `<drive-id>/<item-id>`.
 */
export class OneDriveDocumentSourceAdapter implements DocumentSourceAdapter {
  readonly provider = 'onedrive' as const;
  readonly mode = 'LIVE' as const;

  constructor(private readonly deps: { readonly fetch: FetchLike; readonly secrets: SecretStore }) {}

  private split(config: DocumentSourceConfig): { drive: string; item: string } {
    const [drive, item] = config.folder.split('/');
    if (!drive || !item) throw new DocumentSourceError('NOT_FOUND');
    return { drive: encodeURIComponent(drive), item: encodeURIComponent(item) };
  }

  async list(scope: DocumentSourceScope, config: DocumentSourceConfig): Promise<SourceFile[]> {
    const token = await bearer(this.deps.secrets, scope);
    const { drive, item } = this.split(config);
    const files: SourceFile[] = [];
    const queue: { id: string; path: string }[] = [{ id: item, path: '' }];
    while (queue.length > 0 && files.length < MAX_SOURCE_FILES) {
      const folder = queue.shift() as { id: string; path: string };
      let next: string | undefined = `${GRAPH}/drives/${drive}/items/${folder.id}/children?$select=id,name,size,cTag,file,folder&$top=200`;
      while (next && files.length < MAX_SOURCE_FILES) {
        const response = await this.deps.fetch(next, { headers: { authorization: `Bearer ${token}` } });
        if (!response.ok) throw failure(response.status);
        const page = (await response.json()) as { value?: GraphItem[]; '@odata.nextLink'?: string };
        for (const entry of page.value ?? []) {
          if (entry.folder) queue.push({ id: encodeURIComponent(entry.id), path: folder.path ? `${folder.path}/${entry.name}` : entry.name });
          else if (entry.file)
            files.push({
              externalId: entry.id,
              folder: folder.path,
              name: entry.name,
              mediaType: entry.file.mimeType ?? mediaTypeOf(entry.name),
              sizeBytes: entry.size ?? null,
              version: entry.cTag ?? '0',
            });
        }
        // Graph returns the next page as an absolute URL on its own host.
        const link = page['@odata.nextLink'];
        next = link && link.startsWith(`${GRAPH}/`) ? link : undefined;
      }
    }
    return files.slice(0, MAX_SOURCE_FILES);
  }

  async read(scope: DocumentSourceScope, config: DocumentSourceConfig, file: SourceFile): Promise<Uint8Array> {
    if (file.sizeBytes !== null && file.sizeBytes > MAX_SOURCE_FILE_BYTES) throw new DocumentSourceError('TOO_LARGE');
    const token = await bearer(this.deps.secrets, scope);
    const { drive } = this.split(config);
    const response = await this.deps.fetch(`${GRAPH}/drives/${drive}/items/${encodeURIComponent(file.externalId)}/content`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'manual',
    });
    if (response.status === 302 || response.status === 301 || response.status === 307) {
      const location = response.headers.get('location');
      if (!location || !location.startsWith('https://')) throw new DocumentSourceError('UNAVAILABLE');
      // Pre-authenticated: the token is never sent to the download host.
      const download = await this.deps.fetch(location, {});
      if (!download.ok) throw failure(download.status);
      return bounded(download);
    }
    if (!response.ok) throw failure(response.status);
    return bounded(response);
  }
}

/** A provider that has no live client yet (the VDR partner is not chosen; ADR 0016). */
class UnavailableDocumentSourceAdapter implements DocumentSourceAdapter {
  readonly mode = 'LIVE' as const;
  constructor(readonly provider: DocumentSourceProvider) {}
  async list(): Promise<SourceFile[]> {
    throw new DocumentSourceError('NOT_CONFIGURED');
  }
  async read(): Promise<Uint8Array> {
    throw new DocumentSourceError('NOT_CONFIGURED');
  }
}

/** The only place that looks at (provider, mode). */
export function documentSourceAdapter(
  provider: DocumentSourceProvider,
  mode: 'FIXTURE' | 'LIVE',
  deps: { readonly fetch: FetchLike; readonly secrets: SecretStore; readonly rooms?: Readonly<Record<string, FixtureRoom>> },
): DocumentSourceAdapter {
  if (mode === 'FIXTURE') return new FixtureDocumentSourceAdapter(provider, deps.rooms);
  if (provider === 'google-drive') return new GoogleDriveDocumentSourceAdapter(deps);
  if (provider === 'onedrive') return new OneDriveDocumentSourceAdapter(deps);
  return new UnavailableDocumentSourceAdapter(provider);
}
