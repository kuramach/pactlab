import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { MemorySecretStore } from '@pactlab/connectors';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { SignatureMalwareScanner } from './upload-policy';
import { InMemoryObjectStore } from './testing';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

/**
 * Google, as recorded: the token endpoint (a code, then refreshes), the account, and one Drive folder.
 * Drive accepts only the access token the token endpoint last issued. CI never calls a live provider.
 */
const google = { issued: 'at-1', refreshes: 0, revoked: false, codes: [] as string[] };
const fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(String(init?.body ?? ''));
    if (form.get('client_secret') !== 'g-secret') return json(401, { error: 'invalid_client' });
    if (form.get('grant_type') === 'authorization_code') {
      google.codes.push(form.get('code') ?? '');
      return json(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3599, token_type: 'Bearer' });
    }
    if (google.revoked) return json(400, { error: 'invalid_grant' });
    google.refreshes += 1;
    google.issued = `at-${google.refreshes + 1}`;
    return json(200, { access_token: google.issued, expires_in: 3599, token_type: 'Bearer' });
  }
  if (headers['authorization'] !== `Bearer ${google.issued}`) return json(401, {});
  if (url.startsWith('https://www.googleapis.com/drive/v3/about')) return json(200, { user: { emailAddress: 'seller-ops@example.com', displayName: 'Seller ops', permissionId: 'perm-1' } });
  if (url.includes('alt=media')) return new Response('Cash flow statement FY26 (synthetic)\nOperating: 610,000', { status: 200 });
  return json(200, { files: [{ id: 'f1', name: 'Cash flow FY26.md', mimeType: 'text/markdown', size: '40', version: '2' }] });
};

describe('document sources signed in through the organization (T-147)', { timeout: 180_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  const secrets = new MemorySecretStore();
  const tokens: Record<string, string> = {};
  let sourceId = '';

  const sign = (subject: string) =>
    new SignJWT({ org_id: a.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);

  async function call(who: string, method: 'GET' | 'POST', url: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who] ?? ''}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const base = '/v1/organization/document-connections';

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
    tokens['admin'] = await sign(a.subject);
    const analyst = await addSyntheticDealMember(db.owner, a, 'ANALYST');
    tokens['member'] = await sign(analyst.subject);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('lists the providers: Google Drive offered (its client is set), OneDrive not', async () => {
    expect((await call('admin', 'GET', base)).body).toEqual({
      items: [
        { provider: 'google-drive', label: 'Google Drive', available: true, connected: null },
        { provider: 'onedrive', label: 'OneDrive / SharePoint', available: false, connected: null },
      ],
      canEdit: true,
    });
    expect((await call('admin', 'POST', `${base}/onedrive/start`)).body).toMatchObject({ code: 'SOURCE_NOT_CONFIGURED' });
  });

  it('an admin signs in once: the code is exchanged on the server and the account shown; no token is ever returned', async () => {
    expect((await call('member', 'POST', `${base}/google-drive/start`)).status).toBe(403);
    const started = await call('admin', 'POST', `${base}/google-drive/start`);
    const url = new URL(started.body['url'] as string);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.pactlab.test/settings/document-sources/google-drive/callback');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.readonly');
    const state = url.searchParams.get('state') ?? '';

    // A forged or altered state is refused before any code is exchanged.
    expect((await call('admin', 'POST', `${base}/google-drive/callback`, { code: 'code-x', state: `${state}x` })).status).toBe(403);
    expect(google.codes).toEqual([]);

    const done = await call('admin', 'POST', `${base}/google-drive/callback`, { code: 'code-1', state });
    expect(done.status).toBe(200);
    expect(done.body['items']).toContainEqual({ provider: 'google-drive', label: 'Google Drive', available: true, connected: { accountName: 'seller-ops@example.com', connectedAt: expect.any(String) } });
    expect(JSON.stringify(done.body)).not.toMatch(/at-1|rt-1/);
    const audit = await db.owner.query(`SELECT 1 FROM audit_events WHERE action = 'document_source.account_connected'`);
    expect(audit.rows).toHaveLength(1);
  });

  it('a folder is added without a token, and syncs with the organization’s sign-in', async () => {
    const connected = await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources`, { provider: 'google-drive', mode: 'LIVE', displayName: 'Seller drive', folder: 'folder-1' });
    expect(connected.status).toBe(201);
    sourceId = connected.body['id'] as string;
    const listed = await call('admin', 'GET', `/v1/deals/${a.dealId}/document-sources`);
    expect(listed.body).toMatchObject({ signedIn: ['google-drive'], items: [{ id: sourceId, viaOrganization: true }] });
    const synced = await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources/${sourceId}/sync`);
    expect(synced.status).toBe(200);
    expect(JSON.stringify(synced.body)).toContain('Cash flow FY26.md');
  });

  it('an expired access token is refreshed by itself, with no one signing in again', async () => {
    const [row] = (await db.owner.query<{ credential_ref: string }>(`SELECT credential_ref FROM organization_connections WHERE provider = 'google-drive' AND disconnected_at IS NULL`)).rows;
    const ref = row?.credential_ref ?? '';
    const stored = JSON.parse(await secrets.get(ref)) as Body;
    await secrets.put(ref, JSON.stringify({ ...stored, expiresAt: Date.now() - 1 }));
    const synced = await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources/${sourceId}/sync`);
    expect(synced.status).toBe(200);
    expect(google.refreshes).toBe(1);
    expect(JSON.parse(await secrets.get(ref))).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-1' });
  });

  it('a revoked sign-in reads nothing: the sync says SOURCE_ACCESS once, with no retry loop', async () => {
    const [row] = (await db.owner.query<{ credential_ref: string }>(`SELECT credential_ref FROM organization_connections WHERE provider = 'google-drive' AND disconnected_at IS NULL`)).rows;
    const ref = row?.credential_ref ?? '';
    await secrets.put(ref, JSON.stringify({ ...(JSON.parse(await secrets.get(ref)) as Body), expiresAt: Date.now() - 1 }));
    google.revoked = true;
    const before = google.refreshes;
    const synced = await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources/${sourceId}/sync`);
    expect(synced.body).toMatchObject({ code: 'SOURCE_ACCESS' });
    expect(google.refreshes).toBe(before);
    google.revoked = false;
  });

  it('disconnecting destroys the sign-in; its sources stop reading until the organization connects again', async () => {
    const [row] = (await db.owner.query<{ credential_ref: string }>(`SELECT credential_ref FROM organization_connections WHERE provider = 'google-drive' AND disconnected_at IS NULL`)).rows;
    expect((await call('member', 'POST', `${base}/google-drive/disconnect`)).status).toBe(403);
    const disconnected = await call('admin', 'POST', `${base}/google-drive/disconnect`);
    expect(disconnected.body['items']).toContainEqual(expect.objectContaining({ provider: 'google-drive', connected: null }));
    await expect(secrets.get(row?.credential_ref ?? '')).rejects.toThrow();
    expect((await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources/${sourceId}/sync`)).body).toMatchObject({ code: 'SOURCE_ACCESS' });
    // Signing in again carries the same source over: it reads with the new sign-in.
    const started = await call('admin', 'POST', `${base}/google-drive/start`);
    const state = new URL(started.body['url'] as string).searchParams.get('state') ?? '';
    google.issued = 'at-1';
    await call('admin', 'POST', `${base}/google-drive/callback`, { code: 'code-2', state });
    expect((await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources/${sourceId}/sync`)).status).toBe(200);
  });
});
