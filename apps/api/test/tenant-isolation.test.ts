import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { JwtIdentityVerifier } from '../src/auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

/**
 * API-level tenant isolation proof: two synthetic tenants, real auth guard,
 * real Prisma + RLS (in-process PostgreSQL), signed RS256 tokens.
 */
describe('API tenant isolation', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;
  let foreignKey: CryptoKey;

  async function token(
    tenant: SyntheticTenant,
    overrides: { org?: string; audience?: string; expiresIn?: string; key?: CryptoKey } = {},
  ) {
    return new SignJWT({ org_id: overrides.org ?? tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(tenant.subject)
      .setIssuer(ISSUER)
      .setAudience(overrides.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(overrides.expiresIn ?? '5m')
      .sign(overrides.key ?? signingKey);
  }

  async function get(url: string, bearer?: string) {
    const response = await app.inject({
      method: 'GET',
      url,
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    });
    return { status: response.statusCode, body: response.json() as Record<string, unknown>, headers: response.headers };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');

    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    foreignKey = (await generateKeyPair('RS256')).privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const identityVerifier = new JwtIdentityVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      keys: createLocalJWKSet({ keys: [jwk] }),
    });
    app = await createApp({ prisma: db.prisma, identityVerifier, logger: createLogger('api-test', { level: 'silent' }) });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('serves health without authentication', async () => {
    const response = await get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'api' });
  });

  it('rejects requests without a token as RFC 9457 problem details', async () => {
    const response = await get('/v1/deals');
    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(typeof response.body['requestId']).toBe('string');
  });

  it.each([
    ['a token signed by an unknown key', { key: 'foreign' }],
    ['a token for another audience', { audience: 'https://elsewhere.example' }],
    ['an expired token', { expiresIn: '-1m' }],
  ] as const)('rejects %s', async (_label, override) => {
    const bearer = await token(a, {
      ...('key' in override ? { key: foreignKey } : {}),
      ...('audience' in override ? { audience: override.audience } : {}),
      ...('expiresIn' in override ? { expiresIn: override.expiresIn } : {}),
    });
    expect((await get('/v1/deals', bearer)).status).toBe(401);
  });

  it("rejects a valid user presenting another tenant's organization claim", async () => {
    const bearer = await token(a, { org: b.auth0OrganizationId });
    expect((await get('/v1/deals', bearer)).status).toBe(401);
  });

  it('lists only the caller’s deals (allow + deny)', async () => {
    const [forA, forB] = await Promise.all([get('/v1/deals', await token(a)), get('/v1/deals', await token(b))]);
    expect(forA.status).toBe(200);
    expect((forA.body['items'] as { id: string }[]).map((deal) => deal.id)).toEqual([a.dealId]);
    expect((forB.body['items'] as { id: string }[]).map((deal) => deal.id)).toEqual([b.dealId]);
  });

  it('reads an own deal by id and 404s on another tenant’s deal', async () => {
    const bearer = await token(a);
    const own = await get(`/v1/deals/${a.dealId}`, bearer);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ id: a.dealId, organizationId: a.organizationId, transactionType: 'PRIVATE_ACQUIRER' });
    const other = await get(`/v1/deals/${b.dealId}`, bearer);
    expect(other.status).toBe(404);
    expect(other.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never returns another tenant’s deals from search', async () => {
    const bearer = await token(a);
    const own = await get('/v1/deals?q=Alpha', bearer);
    expect((own.body['items'] as { id: string }[]).map((deal) => deal.id)).toEqual([a.dealId]);
    const other = await get('/v1/deals?q=Bravo', bearer);
    expect(other.body['items']).toEqual([]);
  });

  it('rejects unknown query parameters and malformed ids', async () => {
    const bearer = await token(a);
    expect((await get(`/v1/deals?organizationId=${b.organizationId}`, bearer)).status).toBe(400);
    expect((await get('/v1/deals/not-a-uuid', bearer)).status).toBe(400);
  });
});
