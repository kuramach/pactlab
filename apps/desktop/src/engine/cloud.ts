import { createHash, randomBytes } from 'node:crypto';
import { RINSE_MANIFEST_FILE, rinsePathSchema, type RinseManifest } from '@pactlab/contracts';
import type { RinseDestination } from './folders';

/**
 * Cloud destinations (T-178d): the finished set written to the seller's own OneDrive, Google Drive or
 * Box, through the seller's own sign-in in the app. This sign-in is never the Pactlab login: it is an
 * OAuth 2.0 authorization code grant with PKCE on a loopback redirect (RFC 8252, RFC 7636), run on the
 * seller's machine. The token stays on the machine and goes only to the provider's own hosts; Pactlab
 * never receives it and gets no write access to anyone's cloud. The pact later reads the folder through
 * its own read-only source (ADR 0038).
 *
 * Least privilege per provider:
 * - OneDrive: `Files.ReadWrite.AppFolder` — only the app's own folder (Apps/Pactlab Rinse).
 * - Google Drive: `drive.file` — only files this app creates.
 * - Box: the app's scope is set on its registration (read and write all files and folders is the only
 *   write scope Box offers); a set is written into a new folder of its own.
 */
export const CLOUD_PROVIDERS = ['ONEDRIVE', 'GOOGLE_DRIVE', 'BOX'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

export interface CloudSignInSpec {
  readonly label: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: readonly string[];
  /** The only hosts a request for this provider may reach. */
  readonly hosts: readonly string[];
  /** Box's token endpoint takes the app's client secret even with PKCE. */
  readonly needsClientSecret: boolean;
}

export const CLOUD_SIGN_IN = {
  ONEDRIVE: {
    label: 'OneDrive',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Files.ReadWrite.AppFolder', 'offline_access'],
    hosts: ['login.microsoftonline.com', 'graph.microsoft.com'],
    needsClientSecret: false,
  },
  GOOGLE_DRIVE: {
    label: 'Google Drive',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    hosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'],
    needsClientSecret: false,
  },
  BOX: {
    label: 'Box',
    authorizeUrl: 'https://account.box.com/api/oauth2/authorize',
    tokenUrl: 'https://api.box.com/oauth2/token',
    scopes: [],
    hosts: ['account.box.com', 'api.box.com', 'upload.box.com'],
    needsClientSecret: true,
  },
} as const satisfies Record<CloudProvider, CloudSignInSpec>;

/** Box's single-request upload takes files up to 50 MB; larger ones need its chunked upload, not built. */
export const BOX_MAX_SIMPLE_UPLOAD_BYTES = 50 * 1024 * 1024;

export class CloudDestinationError extends Error {
  constructor(
    readonly reason: 'SIGNED_OUT' | 'EXISTS' | 'TOO_LARGE' | 'REFUSED' | 'UNAVAILABLE' | 'WRONG_HOST',
    detail = '',
  ) {
    super(`Cloud destination: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'CloudDestinationError';
  }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** A request only ever leaves for the provider's own hosts, over HTTPS. */
function guarded(provider: CloudProvider, fetcher: Fetch): Fetch {
  const hosts: readonly string[] = CLOUD_SIGN_IN[provider].hosts;
  return (url, init) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !hosts.includes(parsed.hostname)) return Promise.reject(new CloudDestinationError('WRONG_HOST', parsed.hostname));
    return fetcher(url, { ...init, redirect: 'manual' });
  };
}

async function ok(response: Response): Promise<Response> {
  if (response.ok) return response;
  if (response.status === 401) throw new CloudDestinationError('SIGNED_OUT');
  if (response.status === 409) throw new CloudDestinationError('EXISTS');
  if (response.status === 413) throw new CloudDestinationError('TOO_LARGE');
  if (response.status === 403 || response.status === 400) throw new CloudDestinationError('REFUSED', String(response.status));
  throw new CloudDestinationError('UNAVAILABLE', String(response.status));
}

// ── The seller's own sign-in ──────────────────────────────────────────────────────────────────────

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

/** A PKCE verifier and its S256 challenge (RFC 7636). */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export interface CloudClient {
  /** The Rinse app's own registration with the provider (public client), never a Pactlab login. */
  readonly clientId: string;
  readonly clientSecret?: string | undefined;
  /** A loopback address on the seller's machine, e.g. http://127.0.0.1:53682/callback. */
  readonly redirectUri: string;
}

/** Where to send the seller to sign in. `state` is checked on return. */
export function authorizeUrl(provider: CloudProvider, client: CloudClient, state: string, challenge: string): string {
  const redirect = new URL(client.redirectUri);
  if (redirect.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(redirect.hostname)) throw new CloudDestinationError('REFUSED', 'the redirect must be a loopback address');
  const spec = CLOUD_SIGN_IN[provider];
  const url = new URL(spec.authorizeUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(spec.scopes.length ? { scope: spec.scopes.join(' ') } : {}),
    // Google returns a refresh token only when asked for offline access.
    ...(provider === 'GOOGLE_DRIVE' ? { access_type: 'offline', prompt: 'consent' } : {}),
  }).toString();
  return url.toString();
}

export interface CloudToken {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number;
}

async function tokenRequest(provider: CloudProvider, client: CloudClient, fields: Record<string, string>, fetcher: Fetch, now: () => number): Promise<CloudToken> {
  const spec = CLOUD_SIGN_IN[provider];
  if (spec.needsClientSecret && !client.clientSecret) throw new CloudDestinationError('REFUSED', `${spec.label} needs the app's client secret`);
  const body = new URLSearchParams({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), ...fields });
  const response = await ok(await guarded(provider, fetcher)(spec.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }));
  const json = (await response.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== 'string') throw new CloudDestinationError('REFUSED', 'no access token');
  return { accessToken: json.access_token, refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null, expiresAt: now() + (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000 };
}

/** The code the provider sent back to the loopback address, for the seller's tokens. */
export function exchangeCode(provider: CloudProvider, client: CloudClient, code: string, verifier: string, fetcher: Fetch = fetch, now = Date.now): Promise<CloudToken> {
  return tokenRequest(provider, client, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: client.redirectUri }, fetcher, now);
}

/**
 * The seller's signed-in session with one provider. Held on the machine (the shell keeps the refresh
 * token in the OS keychain); refreshed a minute before it expires. Signing out forgets it.
 */
export class CloudSession {
  private token: CloudToken;

  constructor(
    readonly provider: CloudProvider,
    private readonly client: CloudClient,
    token: CloudToken,
    private readonly fetcher: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.token = token;
  }

  async accessToken(): Promise<string> {
    if (this.token.expiresAt - 60_000 > this.now()) return this.token.accessToken;
    if (!this.token.refreshToken) throw new CloudDestinationError('SIGNED_OUT');
    const next = await tokenRequest(this.provider, this.client, { grant_type: 'refresh_token', refresh_token: this.token.refreshToken }, this.fetcher, this.now);
    // A provider may rotate the refresh token (Microsoft, Box); keep the old one when it does not.
    this.token = { ...next, refreshToken: next.refreshToken ?? this.token.refreshToken };
    return this.token.accessToken;
  }

  /** For the shell to keep in the keychain; never sent anywhere else. */
  get refreshToken(): string | null {
    return this.token.refreshToken;
  }

  request(url: string, init: RequestInit = {}): Promise<Response> {
    return this.accessToken().then((token) => guarded(this.provider, this.fetcher)(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` } }).then(ok));
  }
}

// ── Destinations ──────────────────────────────────────────────────────────────────────────────────

const setFolderName = (manifest: RinseManifest) => manifest.set.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Rinsed set';

/** The media type of each file, from the manifest; the manifest itself is JSON. */
function mediaTypes(manifest: RinseManifest): Map<string, string> {
  const types = new Map<string, string>([[RINSE_MANIFEST_FILE, 'application/json']]);
  for (const document of manifest.documents) {
    if (document.original) types.set(document.original.path, document.original.mediaType);
    if (document.converted) types.set(document.converted.path, document.converted.mediaType);
  }
  return types;
}

/**
 * The shared write: a new folder for the set (never into an existing one), its sub-folders by path, then
 * every file and the manifest. Each provider supplies how to make a folder and upload a file.
 */
abstract class CloudDestination implements RinseDestination {
  abstract readonly kind: 'ONEDRIVE' | 'GOOGLE_DRIVE' | 'BOX';
  protected abstract readonly rootId: string;
  protected abstract readonly rootLabel: string;

  constructor(protected readonly session: CloudSession) {}

  protected abstract createFolder(parentId: string, name: string): Promise<string>;
  protected abstract upload(folderId: string, name: string, bytes: Uint8Array, mediaType: string): Promise<void>;

  async write(files: ReadonlyMap<string, Uint8Array>, manifest: RinseManifest): Promise<{ location: string; written: number }> {
    const name = setFolderName(manifest);
    const types = mediaTypes(manifest);
    const all = [...files, [RINSE_MANIFEST_FILE, new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)] as const];
    for (const [path] of all) if (!rinsePathSchema.safeParse(path).success) throw new Error('A path outside the set');
    const root = await this.createFolder(this.rootId, name);
    const folders = new Map<string, string>([['', root]]);
    const folderFor = async (path: string): Promise<string> => {
      const known = folders.get(path);
      if (known) return known;
      const cut = path.lastIndexOf('/');
      const parent = await folderFor(cut === -1 ? '' : path.slice(0, cut));
      const id = await this.createFolder(parent, cut === -1 ? path : path.slice(cut + 1));
      folders.set(path, id);
      return id;
    };
    let written = 0;
    for (const [path, bytes] of all) {
      const cut = path.lastIndexOf('/');
      const folder = await folderFor(cut === -1 ? '' : path.slice(0, cut));
      await this.upload(folder, cut === -1 ? path : path.slice(cut + 1), bytes, types.get(path) ?? 'application/octet-stream');
      written += 1;
    }
    return { location: `${CLOUD_SIGN_IN[this.kind].label}: ${this.rootLabel}/${name}`, written };
  }
}

const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive';

/** OneDrive through Microsoft Graph, inside the app's own folder (Apps/Pactlab Rinse). */
export class OneDriveDestination extends CloudDestination {
  readonly kind = 'ONEDRIVE' as const;
  protected readonly rootId = 'approot';
  protected readonly rootLabel = 'Apps/Pactlab Rinse';

  protected async createFolder(parentId: string, name: string): Promise<string> {
    const parent = parentId === 'approot' ? `${GRAPH}/special/approot` : `${GRAPH}/items/${encodeURIComponent(parentId)}`;
    const response = await this.session.request(`${parent}/children`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    });
    return ((await response.json()) as { id: string }).id;
  }

  protected async upload(folderId: string, name: string, bytes: Uint8Array, mediaType: string): Promise<void> {
    // Simple upload: one PUT of the content, failing rather than replacing an existing file.
    await this.session.request(`${GRAPH}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=fail`, { method: 'PUT', headers: { 'content-type': mediaType }, body: bytes });
  }
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

/** Google Drive (v3), in My Drive; with `drive.file` the app sees only what it created. */
export class GoogleDriveDestination extends CloudDestination {
  readonly kind = 'GOOGLE_DRIVE' as const;
  protected readonly rootId = 'root';
  protected readonly rootLabel = 'My Drive';

  protected async createFolder(parentId: string, name: string): Promise<string> {
    const response = await this.session.request(`${DRIVE}?fields=id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
    });
    return ((await response.json()) as { id: string }).id;
  }

  protected async upload(folderId: string, name: string, bytes: Uint8Array, mediaType: string): Promise<void> {
    // A resumable session for every file: one request names it, one sends its bytes (any size).
    const start = await this.session.request(`${DRIVE_UPLOAD}?uploadType=resumable&fields=id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': mediaType, 'x-upload-content-length': String(bytes.byteLength) },
      body: JSON.stringify({ name, parents: [folderId] }),
    });
    const location = start.headers.get('location');
    if (!location) throw new CloudDestinationError('UNAVAILABLE', 'no upload session');
    await this.session.request(location, { method: 'PUT', headers: { 'content-type': mediaType }, body: bytes });
  }
}

/** Box (API 2.0), from the seller's All Files folder. */
export class BoxDestination extends CloudDestination {
  readonly kind = 'BOX' as const;
  protected readonly rootId = '0';
  protected readonly rootLabel = 'All Files';

  protected async createFolder(parentId: string, name: string): Promise<string> {
    const response = await this.session.request('https://api.box.com/2.0/folders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, parent: { id: parentId } }) });
    return ((await response.json()) as { id: string }).id;
  }

  protected async upload(folderId: string, name: string, bytes: Uint8Array, mediaType: string): Promise<void> {
    if (bytes.byteLength > BOX_MAX_SIMPLE_UPLOAD_BYTES) throw new CloudDestinationError('TOO_LARGE', `${name} is over Box's 50 MB single upload`);
    const form = new FormData();
    // Box reads the attributes part before the file part.
    form.append('attributes', JSON.stringify({ name, parent: { id: folderId } }));
    form.append('file', new Blob([bytes], { type: mediaType }), name);
    await this.session.request('https://upload.box.com/api/2.0/files/content', { method: 'POST', body: form });
  }
}

/** The destination for a signed-in session. */
export function cloudDestination(session: CloudSession): RinseDestination {
  switch (session.provider) {
    case 'ONEDRIVE':
      return new OneDriveDestination(session);
    case 'GOOGLE_DRIVE':
      return new GoogleDriveDestination(session);
    case 'BOX':
      return new BoxDestination(session);
  }
}
