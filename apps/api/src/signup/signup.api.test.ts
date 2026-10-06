import 'reflect-metadata';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createSyntheticTenant, startTestDatabase, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';
import { decide, listPending } from '../ops/organizations';

const SECRET = 'signup-test-secret-'.padEnd(48, 'x');
const OPERATOR = 'ops@pactlab.example';
type Body = Record<string, unknown>;

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
  to(address: string) {
    return this.sent.filter((message) => message.to === address);
  }
}

const codeIn = (message: OutboundEmail | undefined) => /\b(\d{6})\b/.exec(message?.text ?? '')?.[1] ?? '';
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('self-serve sign-up through the API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  const mail = new CapturingEmailSender();
  const logLines: string[] = [];

  async function call(method: 'GET' | 'POST', url: string, payload?: Body, bearer?: string) {
    const response = await app.inject({
      method,
      url,
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  async function logIn(email: string): Promise<string | null> {
    const before = mail.to(email).length;
    await call('POST', '/v1/auth/email/start', { email });
    await settle();
    const message = mail.to(email)[before];
    if (!message) return null;
    const verified = await call('POST', '/v1/auth/email/verify', { email, code: codeIn(message) });
    return verified.status === 200 ? (verified.body['token'] as string) : null;
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    const existing = await createSyntheticTenant(db.owner, 'Alpha');
    await db.owner.query(`UPDATE users SET email = 'taken@alpha.example' WHERE id = $1`, [existing.userId]);
    const pair = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const destination = new Writable({
      write(chunk, _encoding, done) {
        logLines.push(String(chunk));
        done();
      },
    });
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({
        issuer: 'https://pactlab-test.example/',
        audience: 'https://api.pactlab.test',
        keys: createLocalJWKSet({ keys: [jwk] }),
      }),
      logger: createLogger('api-test', { level: 'trace', destination }),
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
      signup: { requiresApproval: true, operatorEmail: OPERATOR, loginUrl: 'http://localhost:3000/login' },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('asks for a work address', async () => {
    const response = await call('POST', '/v1/signup/start', {
      email: 'someone@gmail.com',
      displayName: 'Someone',
      organizationName: 'Someone Capital',
    });
    expect(response.status).toBe(422);
    expect(mail.to('someone@gmail.com')).toHaveLength(0);
  });

  it('answers the same for new and existing addresses, emailing only the right message', async () => {
    for (const email of ['new@northwind.example', 'taken@alpha.example']) {
      expect(
        await call('POST', '/v1/signup/start', { email, displayName: 'Dana', organizationName: 'Northwind Capital' }),
      ).toEqual({ status: 202, body: { sent: true } });
    }
    await settle();
    expect(codeIn(mail.to('new@northwind.example')[0])).toMatch(/^\d{6}$/);
    const existing = mail.to('taken@alpha.example');
    expect(existing).toHaveLength(1);
    expect(existing[0]!.subject).toBe('You already have a Pactlab account');
    expect(codeIn(existing[0])).toBe('');
  });

  it('creates a pending organization, holds it until approval, then lets the owner in', async () => {
    const email = 'lee@harbor.example';
    await call('POST', '/v1/signup/start', {
      email,
      displayName: 'Lee Harbor',
      organizationName: 'Harbor Partners',
      ssoRequested: true,
    });
    await settle();
    const code = codeIn(mail.to(email)[0]);
    expect((await call('POST', '/v1/signup/verify', { email, code: code === '000000' ? '000001' : '000000' })).status).toBe(401);
    const verified = await call('POST', '/v1/signup/verify', { email, code });
    expect(verified).toEqual({ status: 201, body: { status: 'PENDING_APPROVAL', organizationName: 'Harbor Partners' } });
    await settle();
    const notice = mail.to(OPERATOR).find((message) => message.subject.includes('Harbor Partners'));
    expect(notice?.text).toContain('company SSO');
    expect(notice?.text).toMatch(/pnpm org:approve harbor-partners-[0-9a-f]{6}/);

    // Pending: no login code is sent, so nobody gets in.
    expect(await logIn(email)).toBeNull();

    const pending = await listPending(db.owner);
    const slug = pending.find((org) => org.name === 'Harbor Partners')!.slug;
    expect(pending.find((org) => org.slug === slug)).toMatchObject({ owners: email, ssoRequested: true });
    const approved = await decide(db.owner, slug, 'approve', { sender: mail, loginUrl: 'http://localhost:3000/login' });
    expect(approved).toMatchObject({ kind: 'changed', notified: [email] });
    expect(await decide(db.owner, slug, 'approve', { sender: mail, loginUrl: 'x' })).toEqual({ kind: 'unchanged', status: 'ACTIVE' });

    const token = await logIn(email);
    expect(token).toBeTruthy();
    expect(await call('GET', '/v1/deals', undefined, token!)).toMatchObject({ status: 200, body: { items: [] } });
    const me = await call('GET', '/v1/me', undefined, token!);
    expect(me.body['organizations']).toEqual([expect.objectContaining({ name: 'Harbor Partners', role: 'ORG_OWNER' })]);

    // Rejection (suspension) shuts the door on the next request.
    await decide(db.owner, slug, 'reject', { sender: null, loginUrl: 'x' });
    expect((await call('GET', '/v1/deals', undefined, token!)).status).toBe(401);
  });

  it('never writes codes to logs or audit events', async () => {
    const codes = mail.sent.map(codeIn).filter(Boolean);
    expect(codes.length).toBeGreaterThan(0);
    const audits = (await db.owner.query(`SELECT * FROM audit_events WHERE action LIKE 'org.%' OR action LIKE 'login.%'`)) as {
      rows: unknown[];
    };
    const haystack = JSON.stringify(audits.rows) + logLines.join('');
    for (const code of codes) expect(haystack).not.toContain(`"${code}"`);
    expect(haystack).not.toContain('lee@harbor.example');
  });
});
