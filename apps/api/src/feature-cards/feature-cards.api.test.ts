import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { FEATURE_CARDS, HOME_CARD_LIMIT } from './feature-cards';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

type Card = { id: string; version: number; where: string; unread: boolean };
type View = { home: Card[]; tray: Card[]; unread: number };

describe('feature cards (T-155)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  const newest = [...FEATURE_CARDS].sort((x, y) => (x.addedOn < y.addedOn ? 1 : x.addedOn > y.addedOn ? -1 : x.id.localeCompare(y.id)));

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string | null, method: 'GET' | 'POST', url: string) {
    const response = await app.inject({ method, url, headers: who ? { authorization: `Bearer ${tokens[who]!}` } : {} });
    return { status: response.statusCode, body: response.json() as View };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Cards');
    const b = await createSyntheticTenant(db.owner, 'Cards other org');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
    });
    tokens['ana'] = await token(a.subject, a.auth0OrganizationId);
    tokens['ben'] = await token((await addSyntheticDealMember(db.owner, a, 'ANALYST')).subject, a.auth0OrganizationId);
    tokens['other'] = await token(b.subject, b.auth0OrganizationId);
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('needs a signed-in person', async () => {
    expect((await call(null, 'GET', '/v1/feature-cards')).status).toBe(401);
    expect((await call(null, 'POST', `/v1/feature-cards/${newest[0]!.id}/dismiss`)).status).toBe(401);
  });

  it('starts with the newest cards on the home, capped at two, and the rest queued behind the icon', async () => {
    const view = (await call('ana', 'GET', '/v1/feature-cards')).body;
    expect(view.home.map((card) => card.id)).toEqual(newest.slice(0, HOME_CARD_LIMIT).map((card) => card.id));
    expect(view.tray.map((card) => card.where)).toEqual(newest.slice(HOME_CARD_LIMIT).map(() => 'QUEUED'));
    expect(view.unread).toBe(Math.max(0, newest.length - HOME_CARD_LIMIT));
  });

  it('keeps a dismissal on the server, for that person only', async () => {
    const first = newest[0]!;
    const dismissed = await call('ana', 'POST', `/v1/feature-cards/${first.id}/dismiss`);
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.home.map((card) => card.id)).not.toContain(first.id);
    expect(dismissed.body.tray.find((card) => card.id === first.id)).toMatchObject({ where: 'DISMISSED', unread: true });
    // The next queued card takes its place on the home.
    expect(dismissed.body.home).toHaveLength(Math.min(HOME_CARD_LIMIT, newest.length - 1));

    // A new request (another session) still sees it dismissed; idempotent.
    expect((await call('ana', 'POST', `/v1/feature-cards/${first.id}/dismiss`)).status).toBe(200);
    expect((await call('ana', 'GET', '/v1/feature-cards')).body.tray.map((card) => card.id)).toContain(first.id);
    const persisted = await db.owner.query('SELECT dismissed_version FROM user_feature_cards WHERE card_id = $1', [first.id]);
    expect(persisted.rows).toEqual([{ dismissed_version: first.version }]);

    // A colleague in the same organization and a person in another one are unaffected.
    for (const who of ['ben', 'other']) {
      expect((await call(who, 'GET', '/v1/feature-cards')).body.home.map((card) => card.id)).toContain(first.id);
    }
  });

  it('clears the badge when the list is read, and keeps it clear', async () => {
    const before = (await call('ana', 'GET', '/v1/feature-cards')).body;
    expect(before.unread).toBeGreaterThan(0);
    const read = (await call('ana', 'POST', '/v1/feature-cards/read')).body;
    expect(read.unread).toBe(0);
    expect(read.tray.every((card) => !card.unread)).toBe(true);
    expect((await call('ana', 'GET', '/v1/feature-cards')).body.unread).toBe(0);
    // Reading is also per person.
    expect((await call('ben', 'GET', '/v1/feature-cards')).body.unread).toBe(Math.max(0, newest.length - HOME_CARD_LIMIT));
  });

  it('brings a card back when its version is higher than the one dismissed', async () => {
    const first = newest[0]!;
    // Pretend Ana dismissed an older version, as after a card is updated.
    await db.owner.query("UPDATE user_feature_cards SET dismissed_version = 0 WHERE card_id = $1", [first.id]);
    const view = (await call('ana', 'GET', '/v1/feature-cards')).body;
    expect(view.home.map((card) => card.id)).toContain(first.id);
  });

  it('rejects an unknown or malformed card', async () => {
    expect((await call('ana', 'POST', '/v1/feature-cards/not-a-card/dismiss')).status).toBe(404);
    expect((await call('ana', 'POST', '/v1/feature-cards/NOT_VALID/dismiss')).status).toBe(400);
  });
});
