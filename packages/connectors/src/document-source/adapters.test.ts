import { describe, expect, it } from 'vitest';
import { MemorySecretStore } from '../credentials';
import {
  documentSourceAdapter,
  FixtureDocumentSourceAdapter,
  GoogleDriveDocumentSourceAdapter,
  OneDriveDocumentSourceAdapter,
} from './adapters';
import { FIXTURE_ROOMS } from './fixture-rooms';
import { DocumentSourceError } from './types';

const scope = { credentialRef: 'secretref:pactlab/test/drive' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function secrets() {
  const store = new MemorySecretStore();
  await store.put(scope.credentialRef, 'token-123');
  return store;
}

describe('fixture document source (T-098)', () => {
  it('lists every file in a synthetic room with its folder and reads it back', async () => {
    const adapter = new FixtureDocumentSourceAdapter('google-drive');
    const files = await adapter.list({ credentialRef: null }, { folder: 'brightwave-saas' });
    expect(files).toHaveLength(FIXTURE_ROOMS['brightwave-saas']?.files.length ?? 0);
    const sheet = files.find((file) => file.name === 'BS 30-09-2026.md');
    expect(sheet).toMatchObject({ folder: '04 Legal', mediaType: 'text/markdown', version: '1' });
    const bytes = await adapter.read({ credentialRef: null }, { folder: 'brightwave-saas' }, sheet as NonNullable<typeof sheet>);
    expect(new TextDecoder().decode(bytes)).toContain('balance sheet at 30 September 2026');
  });

  it('says when the room does not exist', async () => {
    await expect(new FixtureDocumentSourceAdapter('vdr').list({ credentialRef: null }, { folder: 'nope' })).rejects.toThrow(DocumentSourceError);
  });

  it('every room states what intake should conclude for each of its files', () => {
    for (const room of Object.values(FIXTURE_ROOMS)) {
      const names = new Set(room.files.map((file) => file.name));
      for (const name of [...Object.keys(room.expect.categories), ...room.expect.duplicates, room.expect.ambiguous, room.expect.misfiled]) expect(names.has(name)).toBe(true);
    }
  });
});

describe('Google Drive document source', () => {
  it('walks folders, exports Google Docs, and sends the bearer token', async () => {
    const calls: { url: string; auth?: string }[] = [];
    const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, ...(init?.headers?.['authorization'] ? { auth: init.headers['authorization'] } : {}) });
      const q = new URL(url).searchParams.get('q') ?? '';
      if (q.startsWith("'root-folder'")) {
        return json({
          files: [
            { id: 'f1', name: 'Rent roll.csv', mimeType: 'text/csv', size: '120', version: '7' },
            { id: 'd1', name: 'Leases', mimeType: 'application/vnd.google-apps.folder' },
          ],
        });
      }
      if (q.startsWith("'d1'")) return json({ files: [{ id: 'g1', name: 'Lease 4B', mimeType: 'application/vnd.google-apps.document', version: '3' }] });
      return new Response('content', { status: 200 });
    };
    const adapter = new GoogleDriveDocumentSourceAdapter({ fetch, secrets: await secrets() });
    const files = await adapter.list(scope, { folder: 'root-folder' });
    expect(files).toEqual([
      { externalId: 'f1', folder: '', name: 'Rent roll.csv', mediaType: 'text/csv', sizeBytes: 120, version: '7' },
      {
        externalId: 'g1',
        folder: 'Leases',
        name: 'Lease 4B.docx',
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: null,
        version: '3',
        exportAs: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    ]);
    await adapter.read(scope, { folder: 'root-folder' }, files[1] as (typeof files)[number]);
    expect(calls.at(-1)?.url).toContain('/files/g1/export?mimeType=application%2Fvnd.openxmlformats');
    await adapter.read(scope, { folder: 'root-folder' }, files[0] as (typeof files)[number]);
    expect(calls.at(-1)?.url).toContain('/files/f1?alt=media');
    expect(calls.every((call) => call.auth === 'Bearer token-123')).toBe(true);
  });

  it('maps refused access and refuses oversized files before downloading', async () => {
    const adapter = new GoogleDriveDocumentSourceAdapter({ fetch: async () => json({}, 403), secrets: await secrets() });
    await expect(adapter.list(scope, { folder: 'x' })).rejects.toMatchObject({ reason: 'ACCESS' });
    await expect(
      adapter.read(scope, { folder: 'x' }, { externalId: 'big', folder: '', name: 'big.pdf', mediaType: 'application/pdf', sizeBytes: 50_000_000, version: '1' }),
    ).rejects.toMatchObject({ reason: 'TOO_LARGE' });
  });

  it('needs a credential', async () => {
    const adapter = new GoogleDriveDocumentSourceAdapter({ fetch: async () => json({}), secrets: await secrets() });
    await expect(adapter.list({ credentialRef: null }, { folder: 'x' })).rejects.toMatchObject({ reason: 'ACCESS' });
  });
});

describe('OneDrive document source', () => {
  it('follows the pre-authenticated download without the token', async () => {
    const calls: { url: string; auth?: string; redirect?: string }[] = [];
    const fetch = async (url: string, init?: { headers?: Record<string, string>; redirect?: string }) => {
      calls.push({ url, ...(init?.headers?.['authorization'] ? { auth: init.headers['authorization'] } : {}), ...(init?.redirect ? { redirect: init.redirect } : {}) });
      if (url.includes('/children')) return json({ value: [{ id: 'i1', name: 'Lease.pdf', size: 10, cTag: 'c1', file: { mimeType: 'application/pdf' } }] });
      if (url.endsWith('/content')) return new Response(null, { status: 302, headers: { location: 'https://download.example/file' } });
      return new Response('pdf-bytes', { status: 200 });
    };
    const adapter = new OneDriveDocumentSourceAdapter({ fetch, secrets: await secrets() });
    const [file] = await adapter.list(scope, { folder: 'drive1/root1' });
    expect(file).toMatchObject({ externalId: 'i1', version: 'c1', mediaType: 'application/pdf' });
    const bytes = await adapter.read(scope, { folder: 'drive1/root1' }, file as NonNullable<typeof file>);
    expect(new TextDecoder().decode(bytes)).toBe('pdf-bytes');
    expect(calls.at(-2)).toMatchObject({ redirect: 'manual', auth: 'Bearer token-123' });
    expect(calls.at(-1)).toEqual({ url: 'https://download.example/file' });
  });
});

describe('documentSourceAdapter', () => {
  it('fails closed for a live VDR until a partner is wired', async () => {
    const adapter = documentSourceAdapter('vdr', 'LIVE', { fetch: async () => json({}), secrets: await secrets() });
    await expect(adapter.list(scope, { folder: 'x' })).rejects.toMatchObject({ reason: 'NOT_CONFIGURED' });
  });
});
