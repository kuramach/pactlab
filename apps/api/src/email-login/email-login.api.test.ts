import 'reflect-metadata';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import type { EmailSender, SignInEmail } from './email-sender';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const SECRET = 'test-secret-'.padEnd(48, 'x');

type Body = Record<string, unknown>;

/** Captures sign-in emails in memory (provider access is blocked in tests). */
class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: SignInEmail[] = [];
  async sendSignInCode(message: SignInEmail) {
    this.sent.push(message);
  }
}

describe('email one-time-code sign-in', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let auth0Tenant: SyntheticTenant;
  let auth0Key: CryptoKey;
  const mail = new CapturingEmailSender();
  const logLines: string[] = [];
  const charlie = { organizationId: newId(), userId: newId(), dealId: newId(), email: 'lead@charlie.example' };
  const multi = { userId: newId(), email: 'multi@charlie.example', second: newId() };

  async function call(method: 'GET' | 'POST', url: string, payload?: Body, bearer?: string) {
    const response = await app.inject({
      method,
      url,
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  /** Request a code and read it from the captured email. */
  async function codeFor(email: string): Promise<string> {
    const before = mail.sent.length;
    const started = await call('POST', '/v1/auth/email/start', { email });
    expect(started).toEqual({ status: 202, body: { sent: true } });
    for (let i = 0; i < 50 && mail.sent.length === before; i += 1) await new Promise((r) => setTimeout(r, 10));
    const message = mail.sent.at(-1);
    if (!message || mail.sent.length === before) throw new Error('No code sent');
    return message.code;
  }

  async function signIn(email: string) {
    const code = await codeFor(email);
    const verified = await call('POST', '/v1/auth/email/verify', { email, code });
    expect(verified.status).toBe(200);
    return verified.body as { token: string; organizationId: string | null; expiresAt: string };
  }

  async function emailCodeOrganization(id: string, label: string) {
    await db.owner.query(
      `INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', now())`,
      [id, `${label} (synthetic)`, `${label.toLowerCase()}-${id.slice(-8)}`],
    );
  }

  async function member(userId: string, email: string, organizationId: string) {
    await db.owner.query(
      `INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [userId, `pactlab|${userId}`, `${email} (synthetic)`, email],
    );
    await db.owner.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_ADMIN')`,
      [newId(), organizationId, userId],
    );
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    auth0Tenant = await createSyntheticTenant(db.owner, 'Alpha');
    await emailCodeOrganization(charlie.organizationId, 'Charlie');
    await member(charlie.userId, charlie.email, charlie.organizationId);
    await db.owner.query(
      `INSERT INTO deals (id, organization_id, name, target_name, transaction_type, created_by, updated_at)
       VALUES ($1, $2, 'Project Charlie', 'Charlie Target (synthetic)', 'PRIVATE_ACQUIRER', $3, now())`,
      [charlie.dealId, charlie.organizationId, charlie.userId],
    );
    await db.owner.query(
      `INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'DEAL_LEAD')`,
      [newId(), charlie.organizationId, charlie.dealId, charlie.userId],
    );
    await member(multi.userId, multi.email, charlie.organizationId);
    await emailCodeOrganization(multi.second, 'Golf');
    await member(multi.userId, multi.email, multi.second);

    const pair = await generateKeyPair('RS256');
    auth0Key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
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
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('signs a member in with an emailed code and scopes the session to their organization', async () => {
    const session = await signIn(charlie.email);
    expect(session.organizationId).toBe(charlie.organizationId);
    const deals = await call('GET', '/v1/deals', undefined, session.token);
    expect(deals.status).toBe(200);
    expect((deals.body['items'] as { id: string }[]).map((d) => d.id)).toEqual([charlie.dealId]);
    const me = await call('GET', '/v1/me', undefined, session.token);
    expect(me.body['organizations']).toEqual([
      expect.objectContaining({ id: charlie.organizationId, authMethod: 'EMAIL_CODE', auth0OrganizationId: null }),
    ]);
  });

  it('answers identically for unknown, Auth0-only and real addresses', async () => {
    await db.owner.query(`UPDATE users SET email = 'alpha@alpha.example' WHERE id = $1`, [auth0Tenant.userId]);
    const before = mail.sent.length;
    for (const email of ['nobody@charlie.example', 'alpha@alpha.example']) {
      expect(await call('POST', '/v1/auth/email/start', { email })).toEqual({ status: 202, body: { sent: true } });
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.sent.length).toBe(before);
    expect((await call('POST', '/v1/auth/email/verify', { email: 'nobody@charlie.example', code: '123456' })).status).toBe(401);
  });

  it('rejects wrong and malformed codes', async () => {
    const code = await codeFor(charlie.email);
    const wrong = code === '000000' ? '000001' : '000000';
    expect((await call('POST', '/v1/auth/email/verify', { email: charlie.email, code: wrong })).status).toBe(401);
    expect((await call('POST', '/v1/auth/email/verify', { email: charlie.email, code: '12ab56' })).status).toBe(400);
    expect((await call('POST', '/v1/auth/email/verify', { email: charlie.email, code })).status).toBe(200);
  });

  it('never lets a sign-in method cross into the other kind of organization', async () => {
    const session = await signIn(charlie.email);
    // Auth0 organization deals are invisible to an email-code session.
    expect((await call('GET', `/v1/deals/${auth0Tenant.dealId}`, undefined, session.token)).status).toBe(404);
    // An Auth0 token claiming the email-code organization's id resolves to nobody.
    const forged = await new SignJWT({ org_id: charlie.organizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(`pactlab|${charlie.userId}`)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(auth0Key);
    expect((await call('GET', '/v1/deals', undefined, forged)).status).toBe(401);
    // A Pactlab-signed token naming another organization fails the session check.
    const tampered = await new SignJWT({ sid: newId(), pactlab_org: auth0Tenant.organizationId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(`pactlab|${charlie.userId}`)
      .setIssuer('pactlab')
      .setAudience('pactlab-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    expect((await call('GET', '/v1/deals', undefined, tampered)).status).toBe(401);
  });

  it('logout revokes the session immediately', async () => {
    const session = await signIn(charlie.email);
    expect((await call('POST', '/v1/auth/logout', undefined, session.token)).status).toBe(204);
    expect((await call('GET', '/v1/deals', undefined, session.token)).status).toBe(401);
  });

  it('multi-organization members pick an organization before reaching tenant data', async () => {
    const session = await signIn(multi.email);
    expect(session.organizationId).toBeNull();
    expect((await call('GET', '/v1/deals', undefined, session.token)).status).toBe(401);
    const me = await call('GET', '/v1/me', undefined, session.token);
    expect((me.body['organizations'] as { id: string }[]).map((o) => o.id).sort()).toEqual(
      [charlie.organizationId, multi.second].sort(),
    );
    expect(
      (await call('POST', '/v1/auth/session/organization', { organizationId: auth0Tenant.organizationId }, session.token)).status,
    ).toBe(401);
    const scoped = await call('POST', '/v1/auth/session/organization', { organizationId: multi.second }, session.token);
    expect(scoped.status).toBe(200);
    expect((await call('GET', '/v1/deals', undefined, scoped.body['token'] as string)).status).toBe(200);
    // The unscoped session was replaced.
    expect((await call('GET', '/v1/me', undefined, session.token)).status).toBe(401);
  });

  it('never writes codes to logs or audit events', async () => {
    const codes = mail.sent.map((message) => message.code);
    expect(codes.length).toBeGreaterThan(0);
    const audits = (await db.owner.query(`SELECT * FROM audit_events WHERE action LIKE 'login.%'`)) as { rows: unknown[] };
    expect(audits.rows.length).toBeGreaterThan(0);
    const haystack = JSON.stringify(audits.rows) + logLines.join('');
    for (const code of codes) expect(haystack).not.toContain(`"${code}"`);
    expect(haystack).not.toContain(charlie.email);
  });
});
