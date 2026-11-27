import { parseRinseManifest, RINSE_MANIFEST_FILE } from '@pactlab/contracts';
import { RINSED_FIXTURE_MANIFEST, RINSED_FIXTURE_ROOM } from '@pactlab/connectors';
import { describe, expect, it } from 'vitest';
import { authorizeUrl, cloudDestination, CloudDestinationError, CloudSession, createPkce, exchangeCode, CLOUD_PROVIDERS, CLOUD_SIGN_IN, type CloudProvider } from './cloud';

/**
 * Cloud destinations (T-178d) against in-memory stand-ins for each provider's documented API: the set
 * lands in a new folder in the seller's own drive, every file at its path, every request to the
 * provider's own hosts with the seller's token — and nothing ever to Pactlab.
 */
const SELLER_TOKEN = 'seller-own-token';
const client = { clientId: 'rinse-desktop', redirectUri: 'http://127.0.0.1:53682/callback' };
const encoder = new TextEncoder();
const FILES = new Map(RINSED_FIXTURE_ROOM.files.filter((file) => file.name !== RINSE_MANIFEST_FILE).map((file) => [file.folder ? `${file.folder}/${file.name}` : file.name, encoder.encode(file.text)] as const));

interface Call {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | undefined;
}

/** A drive: folders by id, files by folder; `paths()` gives what was written, by path from the set's folder. */
class FakeDrive {
  readonly calls: Call[] = [];
  private next = 1;
  private readonly nodes = new Map<string, { name: string; parent: string; folder: boolean; bytes?: Uint8Array }>();
  failWith: number | null = null;

  constructor(readonly root: string) {}

  /** Google Drive allows two folders of one name; OneDrive and Box refuse the second. */
  folder(parent: string, name: string, unique = true): string {
    if (unique && [...this.nodes.values()].some((node) => node.parent === parent && node.name === name && node.folder)) return '';
    const id = `id-${(this.next += 1)}`;
    this.nodes.set(id, { name, parent, folder: true });
    return id;
  }

  file(parent: string, name: string, bytes: Uint8Array): void {
    this.nodes.set(`id-${(this.next += 1)}`, { name, parent, folder: false, bytes });
  }

  paths(): Map<string, string> {
    const pathOf = (id: string): string => {
      const node = this.nodes.get(id);
      return !node || node.parent === this.root ? '' : `${pathOf(node.parent) ? `${pathOf(node.parent)}/` : ''}${node.name}`;
    };
    const top = [...this.nodes.entries()].filter(([, node]) => node.parent === this.root);
    const out = new Map<string, string>();
    for (const node of this.nodes.values()) if (!node.folder) out.set(`${pathOf(node.parent) ? `${pathOf(node.parent)}/` : ''}${node.name}`, new TextDecoder().decode(node.bytes));
    out.set('__set__', top.map(([, node]) => node.name).join(','));
    return out;
  }
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });

function fakeFetch(provider: CloudProvider, drive: FakeDrive) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    drive.calls.push({ url, method: init.method ?? 'GET', authorization: headers['authorization'] });
    if (drive.failWith) return new Response('', { status: drive.failWith });
    const parsed = new URL(url);
    if (provider === 'ONEDRIVE') {
      const children = /\/me\/drive\/(?:special\/(approot)|items\/([^/]+))\/children$/.exec(parsed.pathname);
      if (init.method === 'POST' && children) {
        const body = JSON.parse(String(init.body)) as { name: string; '@microsoft.graph.conflictBehavior': string };
        expect(body['@microsoft.graph.conflictBehavior']).toBe('fail');
        const id = drive.folder(children[1] ?? decodeURIComponent(children[2] ?? ''), body.name);
        return id ? json({ id }, 201) : json({ error: { code: 'nameAlreadyExists' } }, 409);
      }
      const content = /\/me\/drive\/items\/([^/]+):\/(.+):\/content$/.exec(decodeURI(parsed.pathname));
      if (init.method === 'PUT' && content) {
        drive.file(decodeURIComponent(content[1] ?? ''), decodeURIComponent(content[2] ?? ''), init.body as Uint8Array);
        return json({ id: 'file' }, 201);
      }
    }
    if (provider === 'GOOGLE_DRIVE') {
      if (init.method === 'POST' && parsed.pathname === '/drive/v3/files') {
        const body = JSON.parse(String(init.body)) as { name: string; mimeType: string; parents: string[] };
        expect(body.mimeType).toBe('application/vnd.google-apps.folder');
        return json({ id: drive.folder(body.parents[0] ?? '', body.name, false) });
      }
      if (init.method === 'POST' && parsed.pathname === '/upload/drive/v3/files') {
        const body = JSON.parse(String(init.body)) as { name: string; parents: string[] };
        pending.set('1', body);
        return json({}, 200, { location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=1' });
      }
      if (init.method === 'PUT' && parsed.searchParams.get('upload_id')) {
        const meta = pending.get('1') as { name: string; parents: string[] };
        drive.file(meta.parents[0] ?? '', meta.name, init.body as Uint8Array);
        return json({ id: 'file' });
      }
    }
    if (provider === 'BOX') {
      if (init.method === 'POST' && url === 'https://api.box.com/2.0/folders') {
        const body = JSON.parse(String(init.body)) as { name: string; parent: { id: string } };
        const id = drive.folder(body.parent.id, body.name);
        return id ? json({ id }, 201) : json({ code: 'item_name_in_use' }, 409);
      }
      if (init.method === 'POST' && url === 'https://upload.box.com/api/2.0/files/content') {
        const form = init.body as FormData;
        const attributes = JSON.parse(String(form.get('attributes'))) as { name: string; parent: { id: string } };
        const file = form.get('file') as Blob;
        drive.file(attributes.parent.id, attributes.name, new Uint8Array(await file.arrayBuffer()));
        return json({ entries: [{ id: 'file' }] }, 201);
      }
    }
    return new Response('not found', { status: 404 });
  };
}
const pending = new Map<string, unknown>();
const roots: Record<CloudProvider, string> = { ONEDRIVE: 'approot', GOOGLE_DRIVE: 'root', BOX: '0' };
const live = { accessToken: SELLER_TOKEN, refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000 };

describe('the seller signs in to their own drive (T-178d)', () => {
  it('builds a PKCE authorization on a loopback address, with the least scope each provider offers', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const onedrive = new URL(authorizeUrl('ONEDRIVE', client, 'state-1', challenge));
    expect(onedrive.hostname).toBe('login.microsoftonline.com');
    expect(onedrive.searchParams.get('scope')).toBe('Files.ReadWrite.AppFolder offline_access');
    expect(onedrive.searchParams.get('code_challenge_method')).toBe('S256');
    expect(new URL(authorizeUrl('GOOGLE_DRIVE', client, 's', challenge)).searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    // Never a redirect to anywhere but the seller's own machine.
    expect(() => authorizeUrl('BOX', { ...client, redirectUri: 'https://app.pactlab.ai/callback' }, 's', challenge)).toThrow(CloudDestinationError);
    for (const provider of CLOUD_PROVIDERS) expect(CLOUD_SIGN_IN[provider].hosts.some((host) => host.includes('pactlab'))).toBe(false);
  });

  it('exchanges the code at the provider only, and refreshes before the token runs out', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      calls.push(`${url} ${String(init.body)}`);
      return json({ access_token: `token-${calls.length}`, refresh_token: calls.length === 1 ? 'r1' : undefined, expires_in: 3600 });
    };
    let now = 1_000_000;
    const token = await exchangeCode('ONEDRIVE', client, 'code-1', 'verifier-1', fetcher, () => now);
    expect(calls[0]).toContain('https://login.microsoftonline.com/common/oauth2/v2.0/token');
    expect(calls[0]).toContain('code_verifier=verifier-1');
    const session = new CloudSession('ONEDRIVE', client, token, fetcher, () => now);
    expect(await session.accessToken()).toBe('token-1');
    now += 3_600_000;
    expect(await session.accessToken()).toBe('token-2');
    expect(session.refreshToken).toBe('r1');
    // Box's token endpoint takes the app's secret even with PKCE: it is refused without one.
    await expect(exchangeCode('BOX', client, 'c', 'v', fetcher)).rejects.toMatchObject({ reason: 'REFUSED' });
  });
});

describe.each(CLOUD_PROVIDERS)('writing the finished set to %s', (provider) => {
  it('puts every file and the manifest at its path in a new folder of the set, with the seller’s token, to the provider only', async () => {
    const drive = new FakeDrive(roots[provider]);
    const session = new CloudSession(provider, client, live, fakeFetch(provider, drive));
    const result = await cloudDestination(session).write(FILES, RINSED_FIXTURE_MANIFEST);
    expect(result.written).toBe(FILES.size + 1);
    expect(result.location).toContain(RINSED_FIXTURE_MANIFEST.set.name);
    const written = drive.paths();
    expect(written.get('__set__')).toBe(RINSED_FIXTURE_MANIFEST.set.name);
    for (const [path, bytes] of FILES) expect(written.get(path), path).toBe(new TextDecoder().decode(bytes));
    // The manifest written is the one the pact reads back.
    expect(parseRinseManifest(encoder.encode(written.get(RINSE_MANIFEST_FILE) ?? '')).manifest).toEqual(RINSED_FIXTURE_MANIFEST);
    const hosts: readonly string[] = CLOUD_SIGN_IN[provider].hosts;
    for (const call of drive.calls) {
      expect(hosts).toContain(new URL(call.url).hostname);
      expect(call.authorization).toBe(`Bearer ${SELLER_TOKEN}`);
    }
  });

  it('never writes into an existing set, and says when the seller is signed out', async () => {
    const drive = new FakeDrive(roots[provider]);
    const session = new CloudSession(provider, client, live, fakeFetch(provider, drive));
    await cloudDestination(session).write(FILES, RINSED_FIXTURE_MANIFEST);
    if (provider !== 'GOOGLE_DRIVE') await expect(cloudDestination(session).write(FILES, RINSED_FIXTURE_MANIFEST)).rejects.toMatchObject({ reason: 'EXISTS' });
    drive.failWith = 401;
    await expect(cloudDestination(session).write(FILES, RINSED_FIXTURE_MANIFEST)).rejects.toMatchObject({ reason: 'SIGNED_OUT' });
  });
});

it('refuses to follow a provider to a host that is not its own', async () => {
  const fetcher = async (url: string) =>
    url.includes('uploadType=resumable') && !url.includes('upload_id') ? json({}, 200, { location: 'https://uploads.example.com/session/1' }) : json({ id: 'folder' });
  const session = new CloudSession('GOOGLE_DRIVE', client, live, fetcher);
  await expect(cloudDestination(session).write(FILES, RINSED_FIXTURE_MANIFEST)).rejects.toMatchObject({ reason: 'WRONG_HOST' });
});
