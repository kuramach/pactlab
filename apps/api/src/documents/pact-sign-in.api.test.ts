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
 * Google, as recorded: each code is exchanged for its own tokens (one per person), and each folder holds
 * its own files. Drive answers only tokens it issued and not revoked. CI never calls a live provider.
 */
const google = { issued: new Map<string, string>(), revoked: new Set<string>(), seq: 0 };
const FOLDERS: Record<string, { id: string; name: string; text: string }[]> = {
  'buyer-folder': [{ id: 'b1', name: 'Buyer model notes.md', text: 'Buyer working notes (synthetic)' }],
  'seller-folder': [
    { id: 's1', name: 'Customer list.md', text: 'Top customers FY26 (synthetic): Fjord Analytics' },
    { id: 's2', name: 'Cap table.md', text: 'Cap table (synthetic)' },
  ],
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
  const media = /files\/([a-z0-9]+)\?alt=media/.exec(url);
  if (media) return new Response(Object.values(FOLDERS).flat().find((file) => file.id === media[1])?.text ?? '', { status: 200 });
  const folder = /'([a-z-]+)'\+in\+parents|'([a-z-]+)'%20in%20parents|q=%27([a-z-]+)%27/.exec(url);
  const id = folder?.[1] ?? folder?.[2] ?? folder?.[3] ?? Object.keys(FOLDERS).find((name) => url.includes(name)) ?? '';
  return json(200, { files: (FOLDERS[id] ?? []).map((file) => ({ id: file.id, name: file.name, mimeType: 'text/markdown', size: '40', version: '1' })) });
};

describe('connecting a drive folder from the pact, buyer and seller (Kumar, 2026-11-21)', { timeout: 180_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  const secrets = new MemorySecretStore();
  const tokens: Record<string, string> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const sign = (subject: string) =>
    new SignJWT({ org_id: a.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);

  async function call(who: string, method: 'GET' | 'POST', url: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who] ?? ''}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const deal = (path: string) => `/v1/deals/${a.dealId}${path}`;

  /** Sign in from the pact as `who`, the way the browser does: start, the provider's redirect, the callback. */
  async function connect(who: string, folder: string, name: string) {
    const started = await call(who, 'POST', deal('/document-sources/sign-in'), { provider: 'google-drive', folder, displayName: name });
    expect(started.status).toBe(200);
    const url = new URL(started.body['url'] as string);
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.pactlab.test/settings/document-sources/google-drive/callback');
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
      providers: { secrets, fetch, documentOAuth: { 'google-drive': { clientId: 'g-client', clientSecret: 'g-secret' } }, webOrigin: 'https://app.pactlab.test' },
    });
    tokens['lead'] = await sign(a.subject);
    for (const role of ['TARGET_CONTRIBUTOR', 'VIEWER'] as const) {
      const member = await addSyntheticDealMember(db.owner, a, role);
      const name = role === 'TARGET_CONTRIBUTOR' ? 'seller' : 'viewer';
      tokens[name] = await sign(member.subject);
      users[name] = member.userId;
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('the deal lead connects a folder with their own sign-in, no admin or Settings needed; its files are buyer-only', async () => {
    const done = await connect('lead', 'buyer-folder', 'Our working folder');
    expect(done.body).toMatchObject({ kind: 'pact', dealId: a.dealId, sourceId: expect.any(String) });
    ids['buyer'] = done.body['sourceId'] as string;
    expect(JSON.stringify(done.body)).not.toMatch(/at-|rt-/);
    expect((await call('lead', 'POST', deal(`/document-sources/${ids['buyer']}/sync`))).status).toBe(200);
    expect(await visibilityOf('Buyer model notes.md')).toEqual(['BUYER_ONLY']);
    const listed = await call('lead', 'GET', deal('/document-sources'));
    expect(listed.body['items']).toContainEqual(expect.objectContaining({ id: ids['buyer'], kind: 'PERSON', signedInAs: 'lead@example.com', shared: false, canDisconnect: true }));
    expect(listed.body['providers']).toEqual([{ provider: 'google-drive', label: 'Google Drive', organizationSignedIn: false }]);
  });

  it('the seller connects their own Drive folder; its files are shared with the deal and the seller sees them', async () => {
    const done = await connect('seller', 'seller-folder', 'Seller data room');
    expect(done.status).toBe(200);
    ids['seller'] = done.body['sourceId'] as string;
    const synced = await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/sync`));
    expect(synced.status).toBe(200);
    expect(await visibilityOf('Customer list.md')).toEqual(['SHARED']);
    // The seller sees their files; the deal team sees them too.
    const sellerDocs = await call('seller', 'GET', deal('/documents'));
    expect(JSON.stringify(sellerDocs.body)).toContain('Customer list.md');
    expect(JSON.stringify((await call('lead', 'GET', deal('/documents'))).body)).toContain('Customer list.md');
  });

  it('the seller never sees the buyer’s sources or buyer-only files (RLS)', async () => {
    const listed = await call('seller', 'GET', deal('/document-sources'));
    expect(listed.body).toMatchObject({ seller: true, signedIn: [], fixtureRooms: [] });
    expect((listed.body['items'] as { id: string }[]).map((item) => item.id)).toEqual([ids['seller']]);
    expect(JSON.stringify((await call('seller', 'GET', deal('/documents'))).body)).not.toContain('Buyer model notes.md');
    expect((await call('seller', 'POST', deal(`/document-sources/${ids['buyer']}/sync`))).status).toBe(404);
    expect((await call('seller', 'POST', deal(`/document-sources/${ids['buyer']}/disconnect`))).status).toBe(404);
  });

  it('the deal team can sync the seller’s folder too; the files stay shared', async () => {
    expect((await call('lead', 'POST', deal(`/document-sources/${ids['seller']}/sync`))).status).toBe(200);
    expect(await visibilityOf('Cap table.md')).toEqual(['SHARED']);
  });

  it('a file removed from the seller’s folder is marked removed by the seller’s own sync', async () => {
    const removed = FOLDERS['seller-folder']?.pop();
    const synced = await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/sync`));
    expect(synced.status).toBe(200);
    expect(JSON.stringify(synced.body)).toContain('REMOVED');
    const state = await db.owner.query<{ source_state: string }>(`SELECT source_state FROM documents WHERE deal_id = $1 AND file_name = $2`, [a.dealId, removed?.name]);
    expect(state.rows[0]?.source_state).toBe('REMOVED');
  });

  it('refuses a viewer, a forged state, and a state started by someone else', async () => {
    expect((await call('viewer', 'POST', deal('/document-sources/sign-in'), { provider: 'google-drive', folder: 'x', displayName: 'x' })).status).toBe(403);
    const started = await call('seller', 'POST', deal('/document-sources/sign-in'), { provider: 'google-drive', folder: 'seller-folder', displayName: 'Again' });
    const state = new URL(started.body['url'] as string).searchParams.get('state') ?? '';
    expect((await call('seller', 'POST', '/v1/document-sign-ins/google-drive/callback', { code: 'code-x', state: `${state}x` })).status).toBe(403);
    expect((await call('lead', 'POST', '/v1/document-sign-ins/google-drive/callback', { code: 'code-x', state })).status).toBe(403);
    expect((await call('seller', 'POST', '/v1/document-sign-ins/onedrive/callback', { code: 'code-x', state })).status).toBe(403);
  });

  it('a revoked sign-in reads nothing (SOURCE_ACCESS); disconnecting destroys the source’s credential', async () => {
    google.revoked.add('seller');
    expect((await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/sync`))).body).toMatchObject({ code: 'SOURCE_ACCESS' });
    google.revoked.delete('seller');
    const [row] = (await db.owner.query<{ credential_ref: string }>(`SELECT credential_ref FROM document_sources WHERE id = $1`, [ids['seller']])).rows;
    const disconnected = await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/disconnect`));
    expect(disconnected.body).toMatchObject({ status: 'DISABLED' });
    await expect(secrets.get(row?.credential_ref ?? '')).rejects.toThrow();
    expect((await call('seller', 'POST', deal(`/document-sources/${ids['seller']}/sync`))).status).toBe(409); // disabled: nothing is read
    // Files already read stay, as documents do.
    expect(await visibilityOf('Customer list.md')).toEqual(['SHARED']);
  });

  it('the organization sign-in still completes through the same callback', async () => {
    const started = await call('lead', 'POST', '/v1/organization/document-connections/google-drive/start');
    const state = new URL(started.body['url'] as string).searchParams.get('state') ?? '';
    expect((await call('lead', 'POST', '/v1/document-sign-ins/google-drive/callback', { code: 'code-org', state })).body).toEqual({ kind: 'org' });
    expect((await call('lead', 'GET', deal('/document-sources'))).body['providers']).toEqual([{ provider: 'google-drive', label: 'Google Drive', organizationSignedIn: true }]);
  });
});
