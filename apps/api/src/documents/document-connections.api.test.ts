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
 * Microsoft, as recorded: the token endpoint (a code, then refreshes, rotating the refresh token), the
 * account, and one OneDrive folder whose file downloads through a pre-authenticated link. Graph accepts only
 * the access token last issued. CI never calls a live provider.
 */
const ms = { issued: 'at-1', refreshes: 0, revoked: false, codes: [] as string[] };
const fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url === 'https://login.microsoftonline.com/common/oauth2/v2.0/token') {
    const form = new URLSearchParams(String(init?.body ?? ''));
    if (form.get('client_secret') !== 'm-secret') return json(401, { error: 'invalid_client' });
    if (form.get('grant_type') === 'authorization_code') {
      ms.codes.push(form.get('code') ?? '');
      return json(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3599, token_type: 'Bearer' });
    }
    if (ms.revoked) return json(400, { error: 'invalid_grant' });
    ms.refreshes += 1;
    ms.issued = `at-${ms.refreshes + 1}`;
    return json(200, { access_token: ms.issued, refresh_token: `rt-${ms.refreshes + 1}`, expires_in: 3599, token_type: 'Bearer' });
  }
  if (url.startsWith('https://download.example/')) return new Response('Cash flow statement FY26 (synthetic)\nOperating: 610,000', { status: 200 });
  if (headers['authorization'] !== `Bearer ${ms.issued}`) return json(401, {});
  if (url.includes('/content')) return new Response(null, { status: 302, headers: { location: 'https://download.example/f1' } });
  // The chooser: My files, then inside a folder (folders only matter; a file in the list is ignored).
  if (url.includes('/me/drive/root/children')) {
    return json(200, {
      value: [
        { id: 'ME!dulles', name: 'Dulles', folder: { childCount: 1 }, parentReference: { driveId: 'drive-1' } },
        { id: 'ME!notes', name: 'Notes.docx', file: { mimeType: 'application/msword' }, parentReference: { driveId: 'drive-1' } },
      ],
    });
  }
  if (url.includes('/items/ME!dulles/children')) return json(200, { value: [{ id: 'ME!loomis', name: 'Loomis', folder: { childCount: 1 }, parentReference: { driveId: 'drive-1' } }] });
  if (url.startsWith('https://graph.microsoft.com/v1.0/me?') || url === 'https://graph.microsoft.com/v1.0/me') return json(200, { id: 'user-1', mail: 'seller-ops@example.com', userPrincipalName: 'seller-ops@example.com' });
  return json(200, { value: [{ id: 'f1', name: 'Cash flow FY26.md', size: 40, cTag: 'c2', file: { mimeType: 'text/markdown' } }] });
};

describe('OneDrive / SharePoint signed in through the organization (T-147)', { timeout: 180_000 }, () => {
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
      providers: { secrets, fetch, documentOAuth: { 'google-drive': { clientId: 'g-client', clientSecret: 'g-secret' }, onedrive: { clientId: 'm-client', clientSecret: 'm-secret' } }, webOrigin: 'https://app.pactlab.test' },
    });
    tokens['admin'] = await sign(a.subject);
    const analyst = await addSyntheticDealMember(db.owner, a, 'ANALYST');
    tokens['member'] = await sign(analyst.subject);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('an organization Google sign-in from before the picker is retired, and its credential deleted, when an admin opens Settings', async () => {
    const ref = `secretref:${a.organizationId}/google-drive/old-connection`;
    await secrets.put(ref, JSON.stringify({ accessToken: 'old', refreshToken: 'old', expiresAt: 0 }));
    await db.owner.query(
      `INSERT INTO organization_connections (id, organization_id, provider, credential_ref, account_id, account_name, base_uri, connected_by) VALUES (gen_random_uuid(), $1, 'google-drive', $2, 'p', 'kumar@example.com', 'https://www.googleapis.com', $3)`,
      [a.organizationId, ref, a.userId],
    );
    // A member opening Settings changes nothing; an admin does.
    await call('member', 'GET', base);
    expect((await db.owner.query(`SELECT 1 FROM organization_connections WHERE provider = 'google-drive' AND disconnected_at IS NULL`)).rows).toHaveLength(1);
    await call('admin', 'GET', base);
    expect((await db.owner.query(`SELECT 1 FROM organization_connections WHERE provider = 'google-drive' AND disconnected_at IS NULL`)).rows).toHaveLength(0);
    await expect(secrets.get(ref)).rejects.toThrow();
  });

  it('lists the providers: OneDrive offered; Google Drive has no organization sign-in (it is chosen file by file in the picker)', async () => {
    expect((await call('admin', 'GET', base)).body).toEqual({
      items: [
        { provider: 'google-drive', label: 'Google Drive', available: false, connected: null },
        { provider: 'onedrive', label: 'OneDrive / SharePoint', available: true, connected: null },
      ],
      canEdit: true,
    });
    expect((await call('admin', 'POST', `${base}/google-drive/start`)).body).toMatchObject({ code: 'USE_PICKER' });
  });

  it('an admin signs in once: the code is exchanged on the server and the account shown; no token is ever returned', async () => {
    expect((await call('member', 'POST', `${base}/onedrive/start`)).status).toBe(403);
    const started = await call('admin', 'POST', `${base}/onedrive/start`);
    const url = new URL(started.body['url'] as string);
    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.pactlab.test/settings/document-sources/onedrive/callback');
    expect(url.searchParams.get('scope')).toBe('Files.Read.All offline_access User.Read');
    const state = url.searchParams.get('state') ?? '';

    // A forged or altered state is refused before any code is exchanged.
    expect((await call('admin', 'POST', `${base}/onedrive/callback`, { code: 'code-x', state: `${state}x` })).status).toBe(403);
    expect(ms.codes).toEqual([]);

    const done = await call('admin', 'POST', `${base}/onedrive/callback`, { code: 'code-1', state });
    expect(done.status).toBe(200);
    expect(done.body['items']).toContainEqual({ provider: 'onedrive', label: 'OneDrive / SharePoint', available: true, connected: { accountName: 'seller-ops@example.com', connectedAt: expect.any(String) } });
    expect(JSON.stringify(done.body)).not.toMatch(/at-1|rt-1/);
    const audit = await db.owner.query(`SELECT 1 FROM audit_events WHERE action = 'document_source.account_connected'`);
    expect(audit.rows).toHaveLength(1);
  });

  it('a folder is added without a token, and syncs with the organization’s sign-in', async () => {
    const connected = await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources`, { provider: 'onedrive', mode: 'LIVE', displayName: 'Seller drive', folder: 'drive-1/folder-1' });
    expect(connected.status).toBe(201);
    sourceId = connected.body['id'] as string;
    const listed = await call('admin', 'GET', `/v1/deals/${a.dealId}/document-sources`);
    expect(listed.body).toMatchObject({ signedIn: ['onedrive'], items: [{ id: sourceId, viaOrganization: true }] });
    const synced = await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources/${sourceId}/sync`);
    expect(synced.status).toBe(200);
    expect(JSON.stringify(synced.body)).toContain('Cash flow FY26.md');
    // Google Drive cannot be read through an organization sign-in.
    expect((await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources`, { provider: 'google-drive', mode: 'LIVE', displayName: 'G', folder: 'folder-1' })).body).toMatchObject({ code: 'USE_PICKER' });
  });

  it('a folder is chosen in Pactlab, no ids to paste: My files, into a folder, Use this folder, read', async () => {
    const added = await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources`, { provider: 'onedrive', mode: 'LIVE', displayName: 'Loomis data room', folder: '' });
    expect(added.status).toBe(201);
    const id = added.body['id'] as string;
    const listed = await call('admin', 'GET', `/v1/deals/${a.dealId}/document-sources`);
    expect(listed.body['items']).toContainEqual(expect.objectContaining({ id, needsFolder: true, canChooseFolder: true }));
    const top = await call('admin', 'GET', `/v1/deals/${a.dealId}/document-sources/${id}/folders`);
    expect(top.body).toEqual({ items: [{ driveId: 'drive-1', itemId: 'ME!dulles', name: 'Dulles', shared: false }] });
    const inside = await call('admin', 'GET', `/v1/deals/${a.dealId}/document-sources/${id}/folders?driveId=drive-1&itemId=ME!dulles`);
    expect(inside.body).toEqual({ items: [{ driveId: 'drive-1', itemId: 'ME!loomis', name: 'Loomis', shared: false }] });
    // Only the person who connected it browses; another member may not.
    expect((await call('member', 'GET', `/v1/deals/${a.dealId}/document-sources/${id}/folders`)).status).toBe(403);
    expect((await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources/${id}/folder`, { driveId: 'drive-1', itemId: 'ME!loomis' })).status).toBe(200);
    expect((await call('admin', 'GET', `/v1/deals/${a.dealId}/document-sources`)).body['items']).toContainEqual(expect.objectContaining({ id, needsFolder: false }));
    expect((await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources/${id}/sync`)).status).toBe(200);
  });

  it('an expired access token is refreshed by itself, keeping Microsoft’s new refresh token', async () => {
    const [row] = (await db.owner.query<{ credential_ref: string }>(`SELECT credential_ref FROM organization_connections WHERE provider = 'onedrive' AND disconnected_at IS NULL`)).rows;
    const ref = row?.credential_ref ?? '';
    const stored = JSON.parse(await secrets.get(ref)) as Body;
    await secrets.put(ref, JSON.stringify({ ...stored, expiresAt: Date.now() - 1 }));
    const synced = await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources/${sourceId}/sync`);
    expect(synced.status).toBe(200);
    expect(ms.refreshes).toBe(1);
    expect(JSON.parse(await secrets.get(ref))).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2' });
  });

  it('a revoked sign-in reads nothing: the sync says SOURCE_ACCESS once, with no retry loop', async () => {
    const [row] = (await db.owner.query<{ credential_ref: string }>(`SELECT credential_ref FROM organization_connections WHERE provider = 'onedrive' AND disconnected_at IS NULL`)).rows;
    const ref = row?.credential_ref ?? '';
    await secrets.put(ref, JSON.stringify({ ...(JSON.parse(await secrets.get(ref)) as Body), expiresAt: Date.now() - 1 }));
    ms.revoked = true;
    const before = ms.refreshes;
    const synced = await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources/${sourceId}/sync`);
    expect(synced.body).toMatchObject({ code: 'SOURCE_ACCESS' });
    expect(ms.refreshes).toBe(before);
    ms.revoked = false;
  });

  it('disconnecting destroys the sign-in; its sources stop reading until the organization connects again', async () => {
    const [row] = (await db.owner.query<{ credential_ref: string }>(`SELECT credential_ref FROM organization_connections WHERE provider = 'onedrive' AND disconnected_at IS NULL`)).rows;
    expect((await call('member', 'POST', `${base}/onedrive/disconnect`)).status).toBe(403);
    const disconnected = await call('admin', 'POST', `${base}/onedrive/disconnect`);
    expect(disconnected.body['items']).toContainEqual(expect.objectContaining({ provider: 'onedrive', connected: null }));
    await expect(secrets.get(row?.credential_ref ?? '')).rejects.toThrow();
    expect((await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources/${sourceId}/sync`)).body).toMatchObject({ code: 'SOURCE_ACCESS' });
    // Signing in again carries the same source over: it reads with the new sign-in.
    const started = await call('admin', 'POST', `${base}/onedrive/start`);
    const state = new URL(started.body['url'] as string).searchParams.get('state') ?? '';
    ms.issued = 'at-1';
    await call('admin', 'POST', `${base}/onedrive/callback`, { code: 'code-2', state });
    expect((await call('admin', 'POST', `/v1/deals/${a.dealId}/document-sources/${sourceId}/sync`)).status).toBe(200);
  });
});
