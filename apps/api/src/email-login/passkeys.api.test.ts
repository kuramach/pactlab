import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import type { EmailSender, OutboundEmail } from './email-sender';
import { SoftAuthenticator } from './testing';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const SECRET = 'test-secret-'.padEnd(48, 'x');
const ORIGIN = 'http://localhost:3000';

type Body = Record<string, unknown>;
type Options = { challengeId: string; options: { challenge: string; rp: { id: string }; rpId?: string; excludeCredentials?: { id: string }[] } };

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

/** T-108: passkey sign-in end to end through the API, with a software authenticator. */
describe('passkey sign-in', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let auth0Tenant: SyntheticTenant;
  let auth0Key: CryptoKey;
  const mail = new CapturingEmailSender();
  const ana = { organizationId: newId(), userId: newId(), email: 'ana@passkeys.example' };
  const multi = { userId: newId(), email: 'multi@passkeys.example', second: newId() };

  async function call(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Body, bearer?: string) {
    const response = await app.inject({ method, url, headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  async function emailSignIn(email: string): Promise<string> {
    const before = mail.sent.length;
    await call('POST', '/v1/auth/email/start', { email });
    for (let i = 0; i < 50 && mail.sent.length === before; i += 1) await new Promise((r) => setTimeout(r, 10));
    const code = /\b(\d{6})\b/.exec(mail.sent.at(-1)?.text ?? '')?.[1];
    const verified = await call('POST', '/v1/auth/email/verify', { email, code });
    expect(verified.status).toBe(200);
    return verified.body['token'] as string;
  }

  async function addPasskey(token: string, authenticator: SoftAuthenticator, name = 'Synthetic laptop') {
    const options = (await call('POST', '/v1/me/passkeys/options', undefined, token)).body as unknown as Options;
    return call('POST', '/v1/me/passkeys', { challengeId: options.challengeId, name, response: authenticator.register(options.options, ORIGIN) }, token);
  }

  async function passkeySignIn(authenticator: SoftAuthenticator, tweak: { origin?: string; rpId?: string } = {}) {
    const options = (await call('POST', '/v1/auth/passkey/options')).body as unknown as Options;
    const response = authenticator.authenticate(options.options, tweak.origin ?? ORIGIN, tweak.rpId ?? options.options.rpId);
    return { ...(await call('POST', '/v1/auth/passkey/verify', { challengeId: options.challengeId, response })), challengeId: options.challengeId, response };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  beforeAll(async () => {
    db = await startTestDatabase();
    auth0Tenant = await createSyntheticTenant(db.owner, 'Auth0 Org');
    const q = (sql: string, params: unknown[]) => db.owner.query(sql, params);
    for (const [id, label] of [[ana.organizationId, 'Ana Org'], [multi.second, 'Second Org']] as const) {
      await q(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', now())`, [id, `${label} (synthetic)`, `org-${id.slice(-8)}`]);
    }
    for (const person of [ana, multi]) {
      await q(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [person.userId, `pactlab|${person.userId}`, `${person.email} (synthetic)`, person.email]);
    }
    for (const [org, user] of [[ana.organizationId, ana.userId], [ana.organizationId, multi.userId], [multi.second, multi.userId]] as const) {
      await q(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER')`, [newId(), org, user]);
    }
    const pair = await generateKeyPair('RS256');
    auth0Key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
    });
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('a fresh email sign-in sees the offer, adds a passkey, and the owner is emailed', async () => {
    const token = await emailSignIn(ana.email);
    expect((await call('GET', '/v1/me/passkeys', undefined, token)).body).toEqual({ passkeys: [], canAdd: true, offer: true });
    const authenticator = new SoftAuthenticator();
    const added = await addPasskey(token, authenticator, "Ana's laptop");
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body).toMatchObject({ offer: false, passkeys: [{ name: "Ana's laptop", lastUsedAt: null, transports: ['internal'] }] });
    expect(JSON.stringify(added.body)).not.toContain(authenticator.id);
    await settle();
    expect(mail.sent.at(-1)).toMatchObject({ to: ana.email, subject: 'A passkey was added to your Pactlab sign-in' });
    // The same device cannot be added twice: it is excluded from the next options.
    const again = (await call('POST', '/v1/me/passkeys/options', undefined, token)).body as unknown as Options;
    expect(again.options.excludeCredentials?.map((entry) => entry.id)).toEqual([authenticator.id]);

    // Sign in with it: no email, the same session an email code opens.
    const signedIn = await passkeySignIn(authenticator);
    expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
    expect(signedIn.body).toMatchObject({ organizationId: ana.organizationId });
    const me = await call('GET', '/v1/me/passkeys', undefined, signedIn.body['token'] as string);
    expect(me.status).toBe(200);
    expect((me.body['passkeys'] as { lastUsedAt: string | null }[])[0]?.lastUsedAt).not.toBeNull();

    // A replayed answer fails: its challenge was used.
    expect((await call('POST', '/v1/auth/passkey/verify', { challengeId: signedIn.challengeId, response: signedIn.response })).status).toBe(401);
    // Wrong site, wrong relying party, unknown device: the same 401.
    expect((await passkeySignIn(authenticator, { origin: 'https://evil.example' })).status).toBe(401);
    expect((await passkeySignIn(authenticator, { rpId: 'evil.example' })).status).toBe(401);
    expect((await passkeySignIn(new SoftAuthenticator())).status).toBe(401);
  });

  it('a counting authenticator that goes backwards is refused', async () => {
    const token = await emailSignIn(ana.email);
    const key = new SoftAuthenticator({ counter: 3 });
    expect((await addPasskey(token, key, 'Security key')).status).toBe(201);
    expect((await passkeySignIn(key)).status).toBe(200);
    key.counter = 1;
    expect((await passkeySignIn(key)).status).toBe(401);
  });

  it('refuses a registration without user verification', async () => {
    const token = await emailSignIn(ana.email);
    const options = (await call('POST', '/v1/me/passkeys/options', undefined, token)).body as unknown as Options;
    const response = new SoftAuthenticator().register(options.options, ORIGIN, { uv: false });
    expect((await call('POST', '/v1/me/passkeys', { challengeId: options.challengeId, name: 'No PIN', response }, token)).body).toMatchObject({ code: 'PASSKEY_NOT_VERIFIED' });
  });

  it('adding needs a sign-in within 15 minutes', async () => {
    const token = await emailSignIn(ana.email);
    await db.owner.query(`UPDATE auth_sessions SET expires_at = now() + interval '7 hours 30 minutes' WHERE user_id = $1 AND revoked_at IS NULL`, [ana.userId]);
    const listed = await call('GET', '/v1/me/passkeys', undefined, token);
    expect(listed.body['canAdd']).toBe(false);
    const options = await call('POST', '/v1/me/passkeys/options', undefined, token);
    expect(options).toMatchObject({ status: 422, body: { code: 'REAUTH_REQUIRED' } });
  });

  it('an Auth0 sign-in has no Pactlab passkeys', async () => {
    const token = await new SignJWT({ org_id: auth0Tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(auth0Tenant.subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(auth0Key);
    expect(await call('GET', '/v1/me/passkeys', undefined, token)).toMatchObject({ status: 422, body: { code: 'PASSKEYS_EMAIL_CODE_ONLY' } });
    expect((await call('POST', '/v1/me/passkeys/options', undefined, token)).status).toBe(422);
  });

  it('a member of several organizations picks one after a passkey sign-in, as after a code', async () => {
    const token = await emailSignIn(multi.email);
    const authenticator = new SoftAuthenticator();
    expect((await addPasskey(token, authenticator)).status).toBe(201);
    const signedIn = await passkeySignIn(authenticator);
    expect(signedIn.body['organizationId']).toBeNull();
    const picked = await call('POST', '/v1/auth/session/organization', { organizationId: multi.second }, signedIn.body['token'] as string);
    expect(picked).toMatchObject({ status: 200, body: { organizationId: multi.second } });
  });

  it('only the owner removes a passkey; a removed one stops working, and the owner is emailed', async () => {
    const anaToken = await emailSignIn(ana.email);
    const multiToken = await emailSignIn(multi.email);
    const authenticator = new SoftAuthenticator();
    const added = await addPasskey(anaToken, authenticator, 'Old phone');
    const id = (added.body['passkeys'] as { id: string; name: string }[]).find((key) => key.name === 'Old phone')!.id;
    expect((await call('DELETE', `/v1/me/passkeys/${id}`, undefined, multiToken)).body).toMatchObject({ code: 'PASSKEY_NOT_FOUND' });
    const removed = await call('DELETE', `/v1/me/passkeys/${id}`, undefined, anaToken);
    expect(removed.status).toBe(200);
    expect((removed.body['passkeys'] as { id: string }[]).map((key) => key.id)).not.toContain(id);
    await settle();
    expect(mail.sent.at(-1)).toMatchObject({ to: ana.email, subject: 'A passkey was removed from your Pactlab sign-in' });
    expect((await passkeySignIn(authenticator)).status).toBe(401);
  });

  it('"not now" hides the offer for good', async () => {
    const token = await emailSignIn(multi.email);
    expect(await call('POST', '/v1/me/passkeys/offer/dismiss', undefined, token)).toEqual({ status: 200, body: { offer: false } });
    expect((await call('GET', '/v1/me/passkeys', undefined, token)).body['offer']).toBe(false);
  });

  it('rejects malformed answers before verification', async () => {
    expect((await call('POST', '/v1/auth/passkey/verify', { challengeId: newId(), response: { id: 'x', type: 'public-key' } })).status).toBe(400);
  });
});
