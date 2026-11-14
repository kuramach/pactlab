import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import type { WebFetcher, WebResponse } from '../common/safe-fetch';
import { InMemoryObjectStore } from '../documents/testing';
import { BrandService } from './brand.service';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0, 200, 0, 0, 0, 60, 8, 3, 0, 0, 0]), Buffer.from([0, 0, 0, 0]),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#1a7f37"/></svg>');

/** A company website, without the network. */
const site: WebFetcher = {
  async get(url: URL): Promise<WebResponse> {
    const pages: Record<string, { type: string; body: Buffer }> = {
      'https://acme.example/': {
        type: 'text/html',
        body: Buffer.from(`<html><head><meta name="theme-color" content="#0b5fff">
          <script type="application/ld+json">{"@type":"Organization","logo":"https://acme.example/logo.png"}</script>
          <style>body { font-family: Georgia, serif }</style></head></html>`),
      },
      'https://acme.example/logo.png': { type: 'image/png', body: PNG },
    };
    const page = pages[url.toString()];
    return page ? { url, status: 200, contentType: page.type, ...page } : { url, status: 404, contentType: 'text/plain', body: Buffer.alloc(0) };
  },
};

type Body = Record<string, unknown>;

describe('organization brand kits (T-123)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let slugA: string;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);

  async function call(who: string | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: who ? { authorization: `Bearer ${tokens[who]!}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.headers['content-type']?.includes('json') ? response.json() : {}) as Body, headers: response.headers, raw: response.rawPayload };
  }
  const settle = () => app.get(BrandService).whenIdle();

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Branded');
    b = await createSyntheticTenant(db.owner, 'Other');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      documents: { objectStore: new InMemoryObjectStore() },
      webFetcher: site,
    });
    tokens['admin'] = await token(a.subject, a.auth0OrganizationId);
    tokens['admin_b'] = await token(b.subject, b.auth0OrganizationId);
    const member = await addSyntheticDealMember(db.owner, a, 'ANALYST');
    tokens['member'] = await token(member.subject, a.auth0OrganizationId);
    slugA = ((await db.owner.query<{ slug: string }>('SELECT slug FROM organizations WHERE id = $1', [a.organizationId])).rows[0] as { slug: string }).slug;
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('starts on the Pactlab kit, and the sign-in page has no brand of its own', async () => {
    const kit = await call('member', 'GET', '/v1/organization/brand');
    expect(kit.status).toBe(200);
    expect(kit.body).toMatchObject({ source: 'DEFAULT', hasLogo: false, accentColor: null, font: 'MANROPE', canEdit: false, slug: slugA });
    expect((await call(null, 'GET', `/v1/brand/${slugA}`)).status).toBe(404);
  });

  it('lets only owners and admins change it', async () => {
    expect((await call('member', 'PUT', '/v1/organization/brand/website', { websiteUrl: 'https://acme.example/' })).status).toBe(403);
    expect((await call('member', 'PUT', '/v1/organization/brand', { accentColor: '#112233', primaryColor: null, font: 'INTER' })).status).toBe(403);
    expect((await call('member', 'POST', '/v1/organization/brand/logo', { contentBase64: PNG.toString('base64') })).status).toBe(403);
    expect((await call('member', 'DELETE', '/v1/organization/brand')).status).toBe(403);
    expect((await call('admin', 'PUT', '/v1/organization/brand/website', { websiteUrl: 'http://acme.example/' })).status).toBe(400);
  });

  it('drafts a kit from the website for review, and applies it only when asked', async () => {
    expect((await call('admin', 'PUT', '/v1/organization/brand/website', { websiteUrl: 'https://acme.example/' })).status).toBe(200);
    await settle();
    const drafted = await call('admin', 'GET', '/v1/organization/brand');
    expect(drafted.body).toMatchObject({ source: 'DEFAULT', hasLogo: false, websiteUrl: 'https://acme.example/' });
    expect(drafted.body['draft']).toMatchObject({ hasLogo: true, accentColor: '#0b5fff', font: 'SOURCE_SERIF' });
    const preview = await call('admin', 'GET', '/v1/organization/brand/logo?which=draft');
    expect(preview.status).toBe(200);
    expect(preview.headers['content-type']).toBe('image/png');

    const applied = await call('admin', 'POST', '/v1/organization/brand/apply-draft');
    expect(applied.body).toMatchObject({ source: 'EXTRACTED', hasLogo: true, accentColor: '#0b5fff', font: 'SOURCE_SERIF', draft: null });
    expect((await call('member', 'GET', '/v1/organization/brand/logo')).status).toBe(200);
  });

  it('never lets a fresh extraction overwrite an admin’s edit', async () => {
    // A failing accent is kept as chosen, and the readable shade is offered next to it.
    const edited = await call('admin', 'PUT', '/v1/organization/brand', { accentColor: '#FFD400', primaryColor: '#081127', font: 'INTER' });
    expect(edited.body).toMatchObject({ source: 'EDITED', accentColor: '#ffd400', accentAdjusted: true, font: 'INTER' });
    expect(edited.body['accentReadable']).not.toBe('#ffd400');

    expect((await call('admin', 'POST', '/v1/organization/brand/extract')).status).toBe(202);
    await settle();
    const after = await call('admin', 'GET', '/v1/organization/brand');
    expect(after.body).toMatchObject({ source: 'EDITED', accentColor: '#ffd400', font: 'INTER' });
    expect(after.body['draft']).toMatchObject({ accentColor: '#0b5fff' });
  });

  it('accepts an uploaded PNG or SVG, sniffed, and serves it as an inert image', async () => {
    expect((await call('admin', 'POST', '/v1/organization/brand/logo', { contentBase64: Buffer.from('GIF89a....').toString('base64') })).status).toBe(422);
    expect((await call('admin', 'POST', '/v1/organization/brand/logo', { contentBase64: SVG.toString('base64') })).body).toMatchObject({ hasLogo: true, logoContentType: 'image/svg+xml' });
    const logo = await call('member', 'GET', '/v1/organization/brand/logo');
    expect(logo.headers['content-type']).toBe('image/svg+xml');
    expect(logo.headers['content-security-policy']).toContain("default-src 'none'");
    expect(logo.headers['x-content-type-options']).toBe('nosniff');
  });

  it('shows the sign-in page only presentation fields, and no other organization the kit', async () => {
    const pub = await call(null, 'GET', `/v1/brand/${slugA}`);
    expect(pub.status).toBe(200);
    expect(Object.keys(pub.body).sort()).toEqual(['accentColor', 'accentReadable', 'font', 'hasLogo', 'name', 'primaryColor']);
    expect((await call(null, 'GET', `/v1/brand/${slugA}/logo`)).status).toBe(200);
    expect((await call(null, 'GET', '/v1/brand/no-such-org')).status).toBe(404);
    expect((await call(null, 'GET', '/v1/brand/..%2Fadmin')).status).toBe(400);

    const other = await call('admin_b', 'GET', '/v1/organization/brand');
    expect(other.body).toMatchObject({ source: 'DEFAULT', hasLogo: false, accentColor: null });
    expect((await call('admin_b', 'GET', '/v1/organization/brand/logo')).status).toBe(404);
  });

  it('reverts to the Pactlab kit, keeping the draft to apply again', async () => {
    const reverted = await call('admin', 'DELETE', '/v1/organization/brand');
    expect(reverted.body).toMatchObject({ source: 'DEFAULT', hasLogo: false, accentColor: null, font: 'MANROPE' });
    expect(reverted.body['draft']).not.toBeNull();
    expect((await call(null, 'GET', `/v1/brand/${slugA}`)).status).toBe(404);
  });
});
