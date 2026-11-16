import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

describe('organization members API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;

  const token = (tenant: SyntheticTenant, subject = tenant.subject) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey);

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    await addSyntheticDealMember(db.owner, a, 'ANALYST');
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('pages a large organization’s members, each once, and searches across all of them (T-126)', async () => {
    const big = await createSyntheticTenant(db.owner, 'Thousand Co (synthetic)');
    await db.owner.query(
      `INSERT INTO users (id, auth0_subject, display_name, email)
       SELECT uuidv7(), 'pactlab|member-' || n, 'Colleague ' || lpad(n::text, 4, '0'), 'colleague' || n || '@thousand.example' FROM generate_series(1, 149) AS n`,
    );
    await db.owner.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at)
       SELECT uuidv7(), $1, u.id, 'MEMBER', now() + make_interval(secs => row_number() OVER (ORDER BY u.email)) FROM users u WHERE u.email LIKE 'colleague%@thousand.example'`,
      [big.organizationId],
    );
    const headers = { authorization: `Bearer ${await token(big)}` };
    const first = (await app.inject({ method: 'GET', url: '/v1/organization/members?limit=100', headers })).json() as { items: { userId: string }[]; nextCursor: string; total: number };
    expect(first.total).toBe(150);
    expect(first.items).toHaveLength(100);
    const second = (await app.inject({ method: 'GET', url: `/v1/organization/members?limit=100&cursor=${first.nextCursor}`, headers })).json() as { items: { userId: string }[]; nextCursor: string | null };
    expect(second.items).toHaveLength(50);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.userId)).size).toBe(150);
    const search = (await app.inject({ method: 'GET', url: '/v1/organization/members?q=Colleague%200149', headers })).json() as { items: { displayName: string }[]; total: number };
    expect(search).toMatchObject({ total: 1, items: [{ displayName: 'Colleague 0149' }] });
  });

  it('lists only the caller’s organization, with names and roles and no emails', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/organization/members', headers: { authorization: `Bearer ${await token(a)}` } });
    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: { userId: string; displayName: string; role: string }[] }).items;
    expect(items.map((item) => item.role)).toEqual(['ORG_ADMIN', 'MEMBER']);
    expect(items.map((item) => item.userId)).not.toContain(b.userId);
    expect(response.body).not.toContain('email');
  });
});
