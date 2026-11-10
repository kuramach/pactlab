import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { startTestDatabase, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { BillingAdminController, BillingController } from '../billing/billing.controller';
import { DocuSignConnectionController } from '../close/close.controller';
import { DealsController } from '../deals/deals.controller';
import { DealInvitationsController } from '../invitations/invitations.controller';
import { OAuthController } from '../oauth/oauth.controller';
import type { EmailSender, OutboundEmail } from './email-sender';
import { SessionsController } from './sessions.controller';

const SECRET = 'trusted-test-secret-'.padEnd(48, 'x');
const HOUR = 3_600_000;
type Body = Record<string, unknown>;

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

/** T-112 acceptance: trusted devices, the organization's cap, signed-in devices and step-up. */
describe('trusted devices', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  const mail = new CapturingEmailSender();
  const org = newId();
  const admin = { userId: newId(), email: 'admin@trusted.example' };
  const member = { userId: newId(), email: 'member@trusted.example' };

  async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: Body, bearer?: string) {
    const response = await app.inject({ method, url, headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  async function signIn(email: string, extra: Body = {}): Promise<{ token: string; expiresAt: string }> {
    // Many sign-ins in one test: step past the per-address code limit (5 per 15 minutes).
    await db.owner.query(`UPDATE login_challenges SET created_at = created_at - interval '1 hour'`);
    const before = mail.sent.length;
    await call('POST', '/v1/auth/email/start', { email });
    for (let i = 0; i < 50 && mail.sent.length === before; i += 1) await new Promise((r) => setTimeout(r, 10));
    const code = /\b(\d{6})\b/.exec(mail.sent.at(-1)?.text ?? '')?.[1];
    const verified = await call('POST', '/v1/auth/email/verify', { email, code, ...extra });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    return verified.body as { token: string; expiresAt: string };
  }
  const hoursLeft = (expiresAt: string) => Math.round((new Date(expiresAt).getTime() - Date.now()) / HOUR);
  const age = (userId: string, hours: number) =>
    db.owner.query(`UPDATE auth_sessions SET signed_in_at = signed_in_at - make_interval(hours => $2) WHERE user_id = $1 AND revoked_at IS NULL`, [userId, hours]);

  beforeAll(async () => {
    db = await startTestDatabase();
    await db.owner.query(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, 'Trusted Org (synthetic)', $2, 'EMAIL_CODE', now())`, [org, `trusted-${org.slice(-8)}`]);
    for (const [person, role] of [[admin, 'ORG_ADMIN'], [member, 'MEMBER']] as const) {
      await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [person.userId, `pactlab|${person.userId}`, `${person.email} (synthetic)`, person.email]);
      await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)`, [newId(), org, person.userId, role]);
    }
    const pair = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: 'https://pactlab-test.example/', audience: 'https://api.pactlab.test', keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
    });
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('keeps 8 hours by default, and a trusted device for the length chosen within the cap', async () => {
    expect(hoursLeft((await signIn(member.email)).expiresAt)).toBe(8);
    const week = await signIn(member.email, { trust: '1w', device: 'Chrome on macOS' });
    expect(hoursLeft(week.expiresAt)).toBe(168);
    // The default cap is a week: 30 days asked, a week given.
    expect(hoursLeft((await signIn(member.email, { trust: '30d' })).expiresAt)).toBe(168);
    expect((await call('POST', '/v1/auth/email/verify', { email: member.email, code: '000000', trust: '1y' })).status).toBe(400);
  });

  it('lets an admin lower the cap, which applies to sign-ins already open; members cannot', async () => {
    const memberToken = (await signIn(member.email)).token;
    expect((await call('GET', '/v1/organization/session-policy', undefined, memberToken)).body).toEqual({ maxTrustedHours: 168, canEdit: false });
    expect((await call('PUT', '/v1/organization/session-policy', { maxTrustedHours: 24 }, memberToken)).status).toBe(403);
    const longToken = (await signIn(member.email, { trust: '1w' })).token;
    await age(member.userId, 30);
    expect((await call('GET', '/v1/me/sessions', undefined, longToken)).status).toBe(200);

    const adminToken = (await signIn(admin.email)).token;
    const set = await call('PUT', '/v1/organization/session-policy', { maxTrustedHours: 24 }, adminToken);
    expect(set.body).toEqual({ maxTrustedHours: 24, canEdit: true });
    expect((await call('GET', '/v1/me/sessions', undefined, longToken)).status).toBe(401);
    expect(hoursLeft((await signIn(member.email, { trust: '30d' })).expiresAt)).toBe(24);
    const audit = await db.owner.query(`SELECT outcome FROM audit_events WHERE action = 'organization.session_policy_changed' ORDER BY occurred_at`);
    expect((audit.rows as { outcome: string }[]).map((row) => row.outcome)).toEqual(['DENIED', 'SUCCEEDED']);
    await call('PUT', '/v1/organization/session-policy', { maxTrustedHours: 168 }, adminToken);
  });

  it('lists the person’s devices and signs them out, one or everywhere else', async () => {
    const laptop = (await signIn(admin.email, { trust: '1w', device: 'Firefox on Windows' })).token;
    const phone = (await signIn(admin.email, { trust: '1d', device: 'Safari on iOS' })).token;
    const listed = (await call('GET', '/v1/me/sessions', undefined, laptop)).body['devices'] as { id: string; deviceLabel: string | null; trusted: boolean; current: boolean }[];
    expect(listed.find((device) => device.current)).toMatchObject({ deviceLabel: 'Firefox on Windows', trusted: true });
    const phoneRow = listed.find((device) => device.deviceLabel === 'Safari on iOS')!;
    expect((await call('DELETE', `/v1/me/sessions/${phoneRow.id}`, undefined, laptop)).status).toBe(200);
    expect((await call('GET', '/v1/me/sessions', undefined, phone)).status).toBe(401);
    // Someone else's session is not found.
    const theirs = (await call('GET', '/v1/me/sessions', undefined, (await signIn(member.email)).token)).body['devices'] as { id: string }[];
    expect((await call('DELETE', `/v1/me/sessions/${theirs[0]!.id}`, undefined, laptop)).status).toBe(404);
    const others = await call('POST', '/v1/me/sessions/revoke-others', undefined, laptop);
    expect(others.body['signedOut']).toBeGreaterThanOrEqual(1);
    expect(((await call('GET', '/v1/me/sessions', undefined, laptop)).body['devices'] as unknown[]).length).toBe(1);
  });

  it('asks a trusted device to sign in again for sensitive actions after 8 hours', async () => {
    await db.owner.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [admin.userId]);
    const token = (await signIn(admin.email, { trust: '1w' })).token;
    await age(admin.userId, 48);
    // Everyday reads still work on the trusted device...
    expect((await call('GET', '/v1/organization/session-policy', undefined, token)).status).toBe(200);
    // ...a sensitive change needs a fresh sign-in.
    const refused = await call('PUT', '/v1/organization/session-policy', { maxTrustedHours: 720 }, token);
    expect(refused).toMatchObject({ status: 422, body: { code: 'RECENT_SIGN_IN_REQUIRED' } });
    const fresh = (await signIn(admin.email)).token;
    expect((await call('PUT', '/v1/organization/session-policy', { maxTrustedHours: 720 }, fresh)).status).toBe(200);
  });

  it('marks every sensitive route for a recent sign-in', () => {
    const marked = (target: object, method: string) => Reflect.getMetadata('pactlab:recent-sign-in', (target as Record<string, unknown>)[method] as object) === true;
    const routes: [object, string][] = [
      [DealInvitationsController.prototype, 'create'],
      [DealsController.prototype, 'addMember'],
      [DocuSignConnectionController.prototype, 'start'],
      [DocuSignConnectionController.prototype, 'callback'],
      [OAuthController.prototype, 'decide'],
      [BillingController.prototype, 'checkout'],
      [BillingController.prototype, 'portal'],
      [BillingAdminController.prototype, 'createPromoCode'],
      [SessionsController.prototype, 'setPolicy'],
    ];
    for (const [target, method] of routes) expect(marked(target, method), method).toBe(true);
  });
});
