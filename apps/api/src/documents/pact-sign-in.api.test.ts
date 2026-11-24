import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { MemorySecretStore } from '@pactlab/connectors';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { InMemoryObjectStore } from './testing';
import { SignatureMalwareScanner } from './upload-policy';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

/**
 * Google, as recorded, under drive.file: each code is exchanged for its own tokens (one per person), and a
 * file's metadata and content are read by id. Every Drive request is kept, so a test can prove a file nobody
 * chose is never requested. CI never calls a live provider.
 */
const google = { issued: new Map<string, string>(), revoked: new Set<string>(), seq: 0, requested: [] as string[] };
const DRIVE: Record<string, { name: string; text: string }> = {
  buyerFile001: { name: 'Buyer model notes.md', text: 'Buyer working notes (synthetic)' },
  sellerFile01: { name: 'Customer list.md', text: 'Top customers FY26 (synthetic): Fjord Analytics' },
  sellerFile02: { name: 'Cap table.md', text: 'Cap table (synthetic)' },
  'notChosen0001': { name: 'Board minutes.md', text: 'Never chosen (synthetic)' },
};
const fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(String(init?.body ?? ''));
    const code = form.get('code') ?? '';
    google.seq += 1;
    const token = `at-${code}-${google.seq}`;
    google.issued.set(token, code.replace(/^code-/, ''));
    return json(200, { access_token: token, refresh_token: `rt-${code}`, expires_in: 3599, token_type: 'Bearer' });
  }
  const token = (headers['authorization'] ?? '').replace('Bearer ', '');
  const who = google.issued.get(token);
  if (!who || google.revoked.has(who)) return json(401, {});
  if (url.startsWith('https://www.googleapis.com/drive/v3/about')) return json(200, { user: { emailAddress: `${who}@example.com`, permissionId: who } });
  const id = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  google.requested.push(id);
  const file = DRIVE[id];
  if (!file) return json(404, { error: { code: 404 } });
  if (url.includes('alt=media')) return new Response(file.text, { status: 200 });
  return json(200, { id, name: file.name, mimeType: 'text/markdown', size: '40', version: '1' });
};

describe('Google Drive through the picker, from the pact, buyer and seller (Kumar, 2026-11-24)', { timeout: 180_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  const secrets = new MemorySecretStore();
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const sign = (subject: string) =>
    new SignJWT({ org_id: a.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);

  async function call(who: string, method: 'GET' | 'POST', url: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who] ?? ''}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const deal = (path: string) => `/v1/deals/${a.dealId}${path}`;

  /** Sign in from the pact as `who`, as the browser does: start (no folder), Google's redirect, the callback. */
  async function connect(who: string, name: string) {
    const started = await call(who, 'POST', deal('/document-sources/sign-in'), { provider: 'google-drive', displayName: name });
    expect(started.status).toBe(200);
    const url = new URL(started.body['url'] as string);
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    return call(who, 'POST', '/v1/document-sign-ins/google-drive/callback', { code: `code-${who}`, state: url.searchParams.get('state') ?? '' });
  }
  const visibilityOf = async (name: string) =>
    (await db.owner.query<{ visibility: string }>(`SELECT visibility FROM documents WHERE deal_id = $1 AND file_name = $2`, [a.dealId, name])).rows.map((row) => row.visibility);

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner() },
      providers: {
        secrets,
        fetch,
        documentOAuth: { 'google-drive': { clientId: 'g-client', clientSecret: 'g-secret' }, onedrive: { clientId: 'm-client', clientSecret: 'm-secret' } },
        googlePicker: { apiKey: 'AIza-test-key', appId: '250759997538' },
        webOrigin: 'https://app.pactlab.test',
      },
    });
    tokens['lead'] = await sign(a.subject);
    for (const role of ['TARGET_CONTRIBUTOR', 'VIEWER', 'ANALYST'] as const) {
      const member = await addSyntheticDealMember(db.owner, a, role);
      tokens[role === 'TARGET_CONTRIBUTOR' ? 'seller' : role.toLowerCase()] = await sign(member.subject);
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('the deal lead signs in with Google (no folder), opens the picker, chooses a file; only that file is read, buyer-only', async () => {
    const done = await connect('lead', 'Our working files');
    expect(done.body).toMatchObject({ kind: 'pact', dealId: a.dealId, sourceId: expect.any(String) });
    ids['buyer'] = done.body['sourceId'] as string;

    // The picker: the lead's own short-lived token and Pactlab's picker keys, for the lead only.
    const picker = await call('lead', 'GET', deal(`/document-sources/${ids['buyer']}/picker`));
    expect(picker.body).toMatchObject({ accessToken: expect.stringMatching(/^at-code-lead-/), apiKey: 'AIza-test-key', appId: '250759997538' });
    expect((await call('analyst', 'GET', deal(`/document-sources/${ids['buyer']}/picker`))).status).toBe(403);
    expect((await call('viewer', 'GET', deal(`/document-sources/${ids['buyer']}/picker`))).status).toBe(403);
    expect((await db.owner.query(`SELECT 1 FROM audit_events WHERE action = 'document_source.picker_opened' AND outcome = 'SUCCEEDED'`)).rows).toHaveLength(1);

    expect((await call('lead', 'POST', deal(`/document-sources/${ids['buyer']}/files`), { fileIds: ['buyerFile001'] })).body).toEqual({ id: ids['buyer'], filesChosen: 1 });
    expect((await call('lead', 'POST', deal(`/document-sources/${ids['buyer']}/sync`))).status).toBe(200);
    expect(await visibilityOf('Buyer model notes.md')).toEqual(['BUYER_ONLY']);
    expect(google.requested).not.toContain('notChosen0001');

    const listed = await call('lead', 'GET', deal('/document-sources'));
    expect(listed.body['items']).toContainEqual(expect.objectContaining({ id: ids['buyer'], kind: 'PERSON', signedInAs: 'lead@example.com', filesChosen: 1, shared: false, canChooseFiles: true }));
    expect(listed.body['providers']).toEqual([
      { provider: 'google-drive', label: 'Google Drive', organizationSignedIn: false },
      { provider: 'onedrive', label: 'OneDrive / SharePoint', organizationSignedIn: false },
    ]);
  });

  it('the seller chooses files from their own Drive; they are shared with the deal, and the seller sees them', async () => {
    const done = await connect('seller', 'Seller data room');
    ids['seller'] = done.body['sourceId'] as string;
    await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/files`), { fileIds: ['sellerFile01', 'sellerFile02', 'sellerFile01'] });
    const synced = await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/sync`));
    expect(synced.status).toBe(200);
    expect(await visibilityOf('Customer list.md')).toEqual(['SHARED']);
    expect(JSON.stringify((await call('seller', 'GET', deal('/documents'))).body)).toContain('Customer list.md');
    expect(JSON.stringify((await call('lead', 'GET', deal('/documents'))).body)).toContain('Customer list.md');
    expect((await call('seller', 'GET', deal('/document-sources'))).body['items']).toEqual([expect.objectContaining({ id: ids['seller'], filesChosen: 2, shared: true })]);
  });

  it('the picker and file choice belong to the person who signed in; the seller never reaches the buyer’s source', async () => {
    expect((await call('lead', 'GET', deal(`/document-sources/${ids['seller']}/picker`))).status).toBe(403);
    expect((await call('lead', 'POST', deal(`/document-sources/${ids['seller']}/files`), { fileIds: ['buyerFile001'] })).status).toBe(403);
    expect((await call('seller', 'GET', deal(`/document-sources/${ids['buyer']}/picker`))).status).toBe(404);
    expect(JSON.stringify((await call('seller', 'GET', deal('/documents'))).body)).not.toContain('Buyer model notes.md');
    // The deal team may still read the seller's chosen files; they stay shared.
    expect((await call('lead', 'POST', deal(`/document-sources/${ids['seller']}/sync`))).status).toBe(200);
    expect(await visibilityOf('Cap table.md')).toEqual(['SHARED']);
  });

  it('a chosen file deleted at the source is marked removed; files added to the folder later are not read until chosen', async () => {
    const removed = DRIVE['sellerFile02'];
    delete DRIVE['sellerFile02'];
    const synced = await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/sync`));
    expect(JSON.stringify(synced.body)).toContain('REMOVED');
    expect((await db.owner.query<{ source_state: string }>(`SELECT source_state FROM documents WHERE deal_id = $1 AND file_name = $2`, [a.dealId, removed?.name])).rows[0]?.source_state).toBe('REMOVED');
    DRIVE['sellerFile03'] = { name: 'New in the folder.md', text: 'Added later (synthetic)' };
    await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/sync`));
    expect(google.requested).not.toContain('sellerFile03');
    expect((await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/files`), { fileIds: ['sellerFile03'] })).body).toMatchObject({ filesChosen: 3 });
    await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/sync`));
    expect(await visibilityOf('New in the folder.md')).toEqual(['SHARED']);
  });

  it('refuses a viewer, a forged state, a state started by someone else, and an organization sign-in for Google', async () => {
    expect((await call('viewer', 'POST', deal('/document-sources/sign-in'), { provider: 'google-drive', displayName: 'x' })).status).toBe(403);
    const started = await call('seller', 'POST', deal('/document-sources/sign-in'), { provider: 'google-drive', displayName: 'Again' });
    const state = new URL(started.body['url'] as string).searchParams.get('state') ?? '';
    expect((await call('seller', 'POST', '/v1/document-sign-ins/google-drive/callback', { code: 'code-x', state: `${state}x` })).status).toBe(403);
    expect((await call('lead', 'POST', '/v1/document-sign-ins/google-drive/callback', { code: 'code-x', state })).status).toBe(403);
    expect((await call('lead', 'POST', '/v1/organization/document-connections/google-drive/start')).body).toMatchObject({ code: 'USE_PICKER' });
    // OneDrive's folder is chosen in Pactlab after signing in, so none is needed up front.
    expect((await call('lead', 'POST', deal('/document-sources/sign-in'), { provider: 'onedrive', displayName: 'OD' })).status).toBe(200);
  });

  it('a revoked sign-in reads nothing (SOURCE_ACCESS); disconnecting destroys the source’s credential and keeps its files', async () => {
    google.revoked.add('seller');
    expect((await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/sync`))).body).toMatchObject({ code: 'SOURCE_ACCESS' });
    google.revoked.delete('seller');
    const [row] = (await db.owner.query<{ credential_ref: string }>(`SELECT credential_ref FROM document_sources WHERE id = $1`, [ids['seller']])).rows;
    expect((await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/disconnect`))).body).toMatchObject({ status: 'DISABLED' });
    await expect(secrets.get(row?.credential_ref ?? '')).rejects.toThrow();
    expect((await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/sync`))).status).toBe(409);
    expect((await call('seller', 'GET', deal(`/document-sources/${ids['seller']}/picker`))).status).toBe(409);
    expect(await visibilityOf('Customer list.md')).toEqual(['SHARED']);
  });
});
