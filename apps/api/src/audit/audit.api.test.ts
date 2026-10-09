import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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
type Body = Record<string, unknown>;

describe('audit log API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey);

  const get = async (url: string, bearer: string) => {
    const response = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${bearer}` } });
    return { status: response.statusCode, body: response.json() as Body, raw: response.body };
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
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

  it('shows administrators their organization trail, newest first, with names and no IP addresses', async () => {
    const admin = await token(a.subject, a);
    await app.inject({ method: 'PATCH', url: `/v1/deals/${a.dealId}`, headers: { authorization: `Bearer ${admin}` }, payload: { stage: 'DILIGENCE' } });
    await app.inject({ method: 'PATCH', url: `/v1/deals/${b.dealId}`, headers: { authorization: `Bearer ${await token(b.subject, b)}` }, payload: { stage: 'DILIGENCE' } });
    const first = await get('/v1/audit-events?limit=2', admin);
    expect(first.status).toBe(200);
    const items = first.body['items'] as Body[];
    expect(items[0]).toMatchObject({ action: 'deal.updated', dealName: 'Project Alpha', actorName: 'Alpha Lead', outcome: 'SUCCEEDED' });
    expect(first.raw).not.toContain('ipAddress');
    expect(first.raw).not.toContain(b.dealId);

    const filtered = await get(`/v1/audit-events?dealId=${a.dealId}`, admin);
    expect((filtered.body['items'] as Body[]).every((item) => item['dealId'] === a.dealId)).toBe(true);

    // The read itself is on the trail, and paging continues below the last sequence.
    const again = await get('/v1/audit-events?limit=1', admin);
    expect((again.body['items'] as Body[])[0]).toMatchObject({ action: 'audit.read' });
    const next = await get(`/v1/audit-events?limit=1&before=${again.body['nextBefore'] as string}`, admin);
    expect(Number((next.body['items'] as Body[])[0]!['sequence'])).toBeLessThan(Number((again.body['items'] as Body[])[0]!['sequence']));
  });

  it('refuses members without audit access and records the denial', async () => {
    const member = await addSyntheticDealMember(db.owner, a, 'ANALYST');
    expect((await get('/v1/audit-events', await token(member.subject, a))).status).toBe(403);
    const denied = (await db.owner.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE actor_user_id = $1 AND action = 'audit.read' AND outcome = 'DENIED'`,
      [member.userId],
    )) as { rows: { n: number }[] };
    expect(denied.rows[0]!.n).toBe(1);
    expect((await get('/v1/audit-events?limit=500', await token(a.subject, a))).status).toBe(400);
  });
});
