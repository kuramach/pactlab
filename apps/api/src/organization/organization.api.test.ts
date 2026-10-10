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

  it('lists only the caller’s organization, with names and roles and no emails', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/organization/members', headers: { authorization: `Bearer ${await token(a)}` } });
    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: { userId: string; displayName: string; role: string }[] }).items;
    expect(items.map((item) => item.role)).toEqual(['ORG_ADMIN', 'MEMBER']);
    expect(items.map((item) => item.userId)).not.toContain(b.userId);
    expect(response.body).not.toContain('email');
  });
});
