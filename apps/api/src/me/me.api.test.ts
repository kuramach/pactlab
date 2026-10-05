import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@pactlab/domain';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

/** `GET /v1/me` against the real app, auth guard and RLS (in-process PostgreSQL, runtime role). */
describe('GET /v1/me', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;

  async function token(subject: string, claims: Record<string, unknown> = {}) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey);
  }

  async function get(url: string, bearer?: string) {
    const response = await app.inject({
      method: 'GET',
      url,
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    });
    return { status: response.statusCode, body: response.json() as Record<string, unknown> };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');

    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
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

  it('returns the caller and their organizations for an org-less token', async () => {
    const response = await get('/v1/me', await token(a.subject));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: { id: a.userId, displayName: 'Alpha Lead' },
      organizations: [
        {
          id: a.organizationId,
          name: 'Alpha Capital (synthetic)',
          slug: expect.any(String),
          auth0OrganizationId: a.auth0OrganizationId,
          role: 'ORG_ADMIN',
          permissions: ['AUDIT_READ', 'ORG_ADMIN'],
        },
      ],
    });
  });

  it('also serves org-scoped tokens, resolving by subject only', async () => {
    const response = await get('/v1/me', await token(a.subject, { org_id: a.auth0OrganizationId }));
    expect(response.status).toBe(200);
    expect((response.body['organizations'] as { id: string }[]).map((org) => org.id)).toEqual([a.organizationId]);
  });

  it('lists every active membership and omits suspended ones', async () => {
    const member = await addSyntheticDealMember(db.owner, b, 'ANALYST');
    await db.owner.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status) VALUES ($1, $2, $3, 'MEMBER', 'SUSPENDED')`,
      [newId(), a.organizationId, member.userId],
    );
    const response = await get('/v1/me', await token(member.subject));
    expect(response.status).toBe(200);
    expect(response.body['organizations']).toEqual([
      expect.objectContaining({ id: b.organizationId, role: 'MEMBER', permissions: [] }),
    ]);

    await db.owner.query(`UPDATE organization_memberships SET status = 'ACTIVE' WHERE organization_id = $1 AND user_id = $2`, [
      a.organizationId,
      member.userId,
    ]);
    const both = await get('/v1/me', await token(member.subject));
    expect((both.body['organizations'] as { id: string }[]).map((org) => org.id).sort()).toEqual(
      [a.organizationId, b.organizationId].sort(),
    );
  });

  it('ignores client-supplied organization ids', async () => {
    const response = await get(`/v1/me?organizationId=${b.organizationId}`, await token(a.subject));
    expect(response.status).toBe(200);
    expect((response.body['organizations'] as { id: string }[]).map((org) => org.id)).toEqual([a.organizationId]);
  });

  it('rejects an unknown subject', async () => {
    const response = await get('/v1/me', await token('auth0|nobody'));
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects requests without a token or with a malformed organization claim', async () => {
    expect((await get('/v1/me')).status).toBe(401);
    expect((await get('/v1/me', await token(a.subject, { org_id: 42 }))).status).toBe(401);
    expect((await get('/v1/me', await token(a.subject, { org_id: '' }))).status).toBe(401);
  });

  it('rejects an org-scoped token for an organization the caller does not belong to', async () => {
    expect((await get('/v1/me', await token(a.subject, { org_id: b.auth0OrganizationId }))).status).toBe(401);
  });

  it('keeps org-scoped routes closed to org-less tokens', async () => {
    const bearer = await token(a.subject);
    expect((await get('/v1/deals', bearer)).status).toBe(401);
    expect((await get(`/v1/deals/${a.dealId}`, bearer)).status).toBe(401);
    expect((await get('/v1/deals', await token(a.subject, { org_id: a.auth0OrganizationId }))).status).toBe(200);
  });
});
