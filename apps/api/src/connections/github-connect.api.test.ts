import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cassetteFetch, MemorySecretStore, type Cassette, type FetchLike } from '@pactlab/connectors';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, exportPKCS8, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const TOKEN = 'github_pat_TESTONLY0123456789abcdefghij';
const HEAD = '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d';
type Body = Record<string, unknown>;

describe('connecting GitHub live through the API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;
  const secrets = new MemorySecretStore();
  const logLines: string[] = [];
  const seenAuth: string[] = [];

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey);

  async function call(method: 'GET' | 'POST', url: string, bearer: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body, raw: response.body };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };

    const cassette = JSON.parse(
      await readFile(new URL('../../../../fixtures/cassettes/github/octocat__Hello-World.json', import.meta.url), 'utf8'),
    ) as Cassette;
    const replay = cassetteFetch(cassette);
    // App token endpoints follow GitHub's documented shapes; repository reads replay the recording.
    const http: FetchLike = async (url, init) => {
      seenAuth.push(init?.headers?.['authorization'] ?? '');
      if (url.endsWith('/repos/octocat/Hello-World/installation')) return Response.json({ id: 7 });
      if (url.endsWith('/app/installations/7/access_tokens'))
        return Response.json({ token: 'ghs_app_installation', expires_at: '2099-01-01T00:00:00Z' }, { status: 201 });
      return replay(url, init);
    };
    const appKey = await generateKeyPair('RS256', { extractable: true });
    const destination = new Writable({
      write(chunk, _encoding, done) {
        logLines.push(String(chunk));
        done();
      },
    });
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'trace', destination }),
      providers: {
        secrets,
        fetch: http,
        githubApp: { appId: '1001', slug: 'pactlab-test', privateKeyPem: await exportPKCS8(appKey.privateKey) },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('tells the web where to install the App', async () => {
    expect((await call('GET', '/v1/github/app', await token(a.subject, a))).body).toEqual({
      configured: true,
      installUrl: 'https://github.com/apps/pactlab-test/installations/new',
    });
  });

  it('connects with a seller token, stores it only in the secret store and syncs head evidence', async () => {
    const lead = await token(a.subject, a);
    const connected = await call('POST', `/v1/deals/${a.dealId}/connections/github`, lead, {
      method: 'TOKEN',
      repository: 'octocat/Hello-World',
      token: TOKEN,
    });
    expect(connected.status).toBe(201);
    expect(connected.body['validation']).toMatchObject({ ok: true });
    expect(connected.body['connection']).toMatchObject({ provider: 'github', mode: 'LIVE', hasCredential: true });
    expect(connected.raw).not.toContain(TOKEN);
    expect(seenAuth).toContain(`Bearer ${TOKEN}`);

    const connectionId = (connected.body['connection'] as Body)['id'] as string;
    const stored = (await db.owner.query(`SELECT credential_ref FROM connections WHERE id = $1`, [connectionId])) as {
      rows: { credential_ref: string }[];
    };
    expect(stored.rows[0]!.credential_ref).toBe(`secretref:${a.organizationId}/${a.dealId}/github/${connectionId}`);
    await expect(secrets.get(stored.rows[0]!.credential_ref)).resolves.toBe(TOKEN);

    const run = await app.inject({
      method: 'POST',
      url: `/v1/deals/${a.dealId}/sync-runs`,
      headers: { authorization: `Bearer ${lead}`, 'idempotency-key': `sync-${connectionId}` },
      payload: { connectionId },
    });
    expect(run.json()).toMatchObject({ status: 'SUCCEEDED', recordsCreated: 1 });
    const evidence = (await db.owner.query(
      `SELECT e.source_record_id, c.locator FROM evidence_items e JOIN citations c ON c.evidence_item_id = e.id WHERE e.connection_id = $1`,
      [connectionId],
    )) as { rows: { source_record_id: string; locator: Body }[] };
    expect(evidence.rows).toEqual([
      { source_record_id: `octocat/Hello-World@${HEAD}`, locator: { kind: 'git_commit', repository: 'octocat/Hello-World', commitSha: HEAD } },
    ]);

    const audits = (await db.owner.query(`SELECT action FROM audit_events WHERE target_id = $1 ORDER BY chain_seq`, [connectionId])) as {
      rows: { action: string }[];
    };
    expect(audits.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['connection.created', 'connection.credential_stored', 'connection.validated']),
    );
    const everything = JSON.stringify(
      ((await db.owner.query(`SELECT * FROM audit_events`)) as { rows: unknown[] }).rows,
    ) + logLines.join('');
    expect(everything).not.toContain(TOKEN);
  });

  it('connects through the GitHub App with a token narrowed to the repository', async () => {
    const connected = await call('POST', `/v1/deals/${a.dealId}/connections/github`, await token(a.subject, a), {
      method: 'APP',
      repository: 'octocat/Hello-World',
    });
    expect(connected.status).toBe(201);
    expect(connected.body['validation']).toMatchObject({ ok: true });
    expect(seenAuth).toContain('Bearer ghs_app_installation');
  });

  it('reports a repository the credential cannot see without failing the request', async () => {
    const connected = await call('POST', `/v1/deals/${a.dealId}/connections/github`, await token(a.subject, a), {
      method: 'TOKEN',
      repository: 'octocat/pactlab-does-not-exist',
      token: TOKEN,
    });
    expect(connected.status).toBe(201);
    const validation = connected.body['validation'] as { ok: boolean; checks: { name: string; status: string }[] };
    expect(validation.ok).toBe(false);
    expect(validation.checks.find((check) => check.name === 'reachability')?.status).toBe('FAIL');
  });

  it('rejects malformed input, refuses viewers and hides the deal from other tenants', async () => {
    const lead = await token(a.subject, a);
    for (const payload of [
      { method: 'TOKEN', repository: 'octocat/Hello-World' },
      { method: 'TOKEN', repository: '../etc', token: TOKEN },
      { method: 'APP', repository: 'octocat/Hello-World', token: TOKEN },
    ]) {
      expect((await call('POST', `/v1/deals/${a.dealId}/connections/github`, lead, payload)).status, JSON.stringify(payload)).toBe(400);
    }
    const viewer = await addSyntheticDealMember(db.owner, a, 'VIEWER');
    const body = { method: 'TOKEN', repository: 'octocat/Hello-World', token: TOKEN };
    expect((await call('POST', `/v1/deals/${a.dealId}/connections/github`, await token(viewer.subject, a), body)).status).toBe(403);
    expect((await call('POST', `/v1/deals/${a.dealId}/connections/github`, await token(b.subject, b), body)).status).toBe(404);
  });
});

describe('GitHub connections without live configuration', () => {
  it('fail closed: no App, no secret store', async () => {
    const db = await startTestDatabase();
    try {
      const tenant = await createSyntheticTenant(db.owner, 'Solo');
      const pair = await generateKeyPair('RS256');
      const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
      const app = await createApp({
        prisma: db.prisma,
        identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
        logger: createLogger('api-test', { level: 'silent' }),
      });
      const bearer = await new SignJWT({ org_id: tenant.auth0OrganizationId })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setSubject(tenant.subject)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(pair.privateKey);
      const post = (payload: Body) =>
        app.inject({ method: 'POST', url: `/v1/deals/${tenant.dealId}/connections/github`, headers: { authorization: `Bearer ${bearer}` }, payload });
      expect((await app.inject({ method: 'GET', url: '/v1/github/app', headers: { authorization: `Bearer ${bearer}` } })).json()).toEqual({
        configured: false,
        installUrl: null,
      });
      expect((await post({ method: 'APP', repository: 'octocat/Hello-World' })).statusCode).toBe(409);
      expect((await post({ method: 'TOKEN', repository: 'octocat/Hello-World', token: TOKEN })).statusCode).toBe(503);
      await app.close();
    } finally {
      await db.stop();
    }
  }, 60_000);
});
