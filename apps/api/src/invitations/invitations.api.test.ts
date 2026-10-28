import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { startTestDatabase, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';

const SECRET = 'test-secret-'.padEnd(48, 'x');
type Body = Record<string, unknown>;

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

/** T-094 B12 / ADR 0014: invite someone from another party to one pact; they join it, never the organization. */
describe('pact invitations and guests', { timeout: 60_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  const mail = new CapturingEmailSender();
  const charlie = { organizationId: newId(), lead: newId(), colleague: newId(), deal: newId(), otherDeal: newId() };

  async function call(method: 'GET' | 'POST', url: string, payload?: Body, bearer?: string) {
    const response = await app.inject({ method, url, headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const lastMail = async (to: string) => {
    for (let i = 0; i < 100 && !mail.sent.some((m) => m.to === to); i += 1) await new Promise((r) => setTimeout(r, 10));
    const message = [...mail.sent].reverse().find((m) => m.to === to);
    if (!message) throw new Error(`no email to ${to}`);
    return message;
  };
  async function signIn(email: string) {
    const before = mail.sent.length;
    expect((await call('POST', '/v1/auth/email/start', { email })).status).toBe(202);
    for (let i = 0; i < 100 && mail.sent.length === before; i += 1) await new Promise((r) => setTimeout(r, 10));
    const code = /\b(\d{6})\b/.exec(mail.sent.at(-1)?.text ?? '')?.[1];
    const verified = await call('POST', '/v1/auth/email/verify', { email, code });
    expect(verified.status).toBe(200);
    return verified.body['token'] as string;
  }
  const tokenFrom = (message: OutboundEmail) => /\/invite\/([A-Za-z0-9_-]{43})/.exec(message.text)?.[1] ?? '';

  beforeAll(async () => {
    db = await startTestDatabase();
    const q = (sql: string, params: unknown[]) => db.owner.query(sql, params);
    await q(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, 'Charlie Capital (synthetic)', $2, 'EMAIL_CODE', now())`, [charlie.organizationId, `charlie-${charlie.organizationId.slice(-8)}`]);
    for (const [id, email] of [
      [charlie.lead, 'lead@charlie.example'],
      [charlie.colleague, 'colleague@charlie.example'],
    ] as const) {
      await q(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [id, `pactlab|${id}`, `${email.split('@')[0]} (synthetic)`, email]);
      await q(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_ADMIN')`, [newId(), charlie.organizationId, id]);
    }
    for (const [id, name] of [
      [charlie.deal, 'Project Charlie'],
      [charlie.otherDeal, 'Project Elsewhere'],
    ] as const) {
      await q(`INSERT INTO deals (id, organization_id, name, target_name, transaction_type, created_by, updated_at) VALUES ($1, $2, $3, 'Target (synthetic)', 'PRIVATE_ACQUIRER', $4, now())`, [id, charlie.organizationId, name, charlie.lead]);
      await q(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'DEAL_LEAD')`, [newId(), charlie.organizationId, id, charlie.lead]);
    }
    // Buyer-only: the asking price, which a seller-side guest must never read.
    await q(`INSERT INTO asking_prices (id, organization_id, deal_id, version, amount, currency, basis, source, recorded_by, recorded_at) VALUES ($1, $2, $3, 1, 20000000, 'USD', 'ENTERPRISE_VALUE', 'TEASER', $4, now())`, [newId(), charlie.organizationId, charlie.deal, charlie.lead]);
    const pair = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: 'https://pactlab-test.example/', audience: 'https://api.pactlab.test', keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: process.env['DEBUG_API'] ? 'error' : 'silent' }),
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
      signup: { requiresApproval: true, loginUrl: 'https://app.pactlab.test/login' },
    });
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('a seller invited by email signs up (personal address, no approval wait), accepts, and sees only that pact', async () => {
    const lead = await signIn('lead@charlie.example');
    const invited = await call('POST', `/v1/deals/${charlie.deal}/invitations`, { email: 'Seller.Founder@gmail.com', side: 'SELLER', role: 'TARGET_CONTRIBUTOR' }, lead);
    expect(invited).toEqual({ status: 201, body: { kind: 'INVITED' } });
    const email = await lastMail('seller.founder@gmail.com');
    expect(email.text).toContain('https://app.pactlab.test/invite/');
    expect(email.text).toContain('You join this pact only');
    const token = tokenFrom(email);

    // A second invitation to the same address while one is pending is refused.
    expect((await call('POST', `/v1/deals/${charlie.deal}/invitations`, { email: 'seller.founder@gmail.com', side: 'SELLER', role: 'TARGET_CONTRIBUTOR' }, lead)).status).toBe(409);
    // A seller can only ever be a target contributor.
    expect((await call('POST', `/v1/deals/${charlie.deal}/invitations`, { email: 'x@seller.example', side: 'SELLER', role: 'ANALYST' }, lead)).status).toBe(400);

    expect(await call('GET', `/v1/invitations/${token}`)).toMatchObject({ status: 200, body: { dealName: 'Project Charlie', organizationName: 'Charlie Capital (synthetic)', side: 'SELLER', role: 'TARGET_CONTRIBUTOR', status: 'PENDING' } });
    expect((await call('GET', `/v1/invitations/${'x'.repeat(43)}`)).status).toBe(404);

    // Sign-up from the invitation: a personal address is fine and the home organization is active at once.
    expect((await call('POST', '/v1/signup/start', { email: 'seller.founder@gmail.com', displayName: 'Sam Seller', organizationName: 'Loopwise (synthetic)', invitationToken: token })).status).toBe(202);
    const code = /\b(\d{6})\b/.exec((await lastMail('seller.founder@gmail.com')).text)?.[1];
    expect((await call('POST', '/v1/signup/verify', { email: 'seller.founder@gmail.com', code, invitationToken: token })).body).toMatchObject({ status: 'ACTIVE' });
    // Without an invitation the work-email rule still applies.
    expect((await call('POST', '/v1/signup/start', { email: 'someone@gmail.com', displayName: 'X', organizationName: 'Xyz Ltd' })).status).toBe(422);

    // Someone else cannot accept it: the signed-in address must match.
    expect((await call('POST', `/v1/invitations/${token}/accept`, undefined, await signIn('colleague@charlie.example'))).status).toBe(422);

    const home = await signIn('seller.founder@gmail.com');
    const accepted = await call('POST', `/v1/invitations/${token}/accept`, undefined, home);
    expect(accepted).toEqual({ status: 200, body: { organizationId: charlie.organizationId, dealId: charlie.deal } });
    expect((await call('POST', `/v1/invitations/${token}/accept`, undefined, home)).status).toBe(422); // used once
    const me = await call('GET', '/v1/me', undefined, home);
    expect(me.body['guestPacts']).toEqual([{ organizationId: charlie.organizationId, organizationName: 'Charlie Capital (synthetic)', dealId: charlie.deal, dealName: 'Project Charlie', role: 'TARGET_CONTRIBUTOR' }]);

    // Switch onto the pact: a guest session in Charlie's organization.
    const switched = await call('POST', '/v1/auth/session/organization', { organizationId: charlie.organizationId }, home);
    expect(switched.status).toBe(200);
    const guest = switched.body['token'] as string;
    const deals = await call('GET', '/v1/deals', undefined, guest);
    expect((deals.body['items'] as Body[]).map((deal) => deal['name'])).toEqual(['Project Charlie']);
    expect((await call('GET', `/v1/deals/${charlie.deal}`, undefined, guest)).status).toBe(200);
    expect((await call('GET', `/v1/deals/${charlie.otherDeal}`, undefined, guest)).status).toBe(404);
    expect((await call('GET', `/v1/deals/${charlie.deal}/asking-price`, undefined, guest)).status).toBe(403);
    expect((await call('GET', '/v1/organization/members', undefined, guest)).status).toBe(404);
    expect((await call('POST', '/v1/deals', { name: 'Mine', targetName: 'T', transactionType: 'PRIVATE_ACQUIRER' }, guest)).status).toBe(403);
    expect((await call('GET', `/v1/deals/${charlie.deal}/invitations`, undefined, guest)).status).toBe(404);
    // Each side sees the other on the pact, by name and role.
    const seen = (await call('GET', `/v1/deals/${charlie.deal}/members`, undefined, guest)).body['items'] as Body[];
    expect(seen.map((member) => member['role']).sort()).toEqual(['DEAL_LEAD', 'TARGET_CONTRIBUTOR']);

    const team = (await call('GET', `/v1/deals/${charlie.deal}/members`, undefined, lead)).body['items'] as Body[];
    expect(team.find((member) => member['role'] === 'TARGET_CONTRIBUTOR')).toMatchObject({ displayName: 'Sam Seller' });
    const list = await call('GET', `/v1/deals/${charlie.deal}/invitations`, undefined, lead);
    expect((list.body['items'] as Body[])[0]).toMatchObject({ email: 'seller.founder@gmail.com', status: 'ACCEPTED', side: 'SELLER' });
    const audit = await db.owner.query(`SELECT action FROM audit_events WHERE deal_id = $1 AND action LIKE 'deal.invitation%' ORDER BY occurred_at`, [charlie.deal]);
    expect((audit.rows as Body[]).map((row) => row['action'])).toEqual(['deal.invitation.created', 'deal.invitation_accepted']);
  });

  it('a colleague in the organization joins directly; a revoked invitation cannot be accepted', async () => {
    const lead = await signIn('lead@charlie.example');
    expect(await call('POST', `/v1/deals/${charlie.otherDeal}/invitations`, { email: 'colleague@charlie.example', side: 'BUYER', role: 'ANALYST' }, lead)).toEqual({ status: 201, body: { kind: 'ADDED' } });
    expect((await call('POST', `/v1/deals/${charlie.otherDeal}/invitations`, { email: 'colleague@charlie.example', side: 'SELLER', role: 'TARGET_CONTRIBUTOR' }, lead)).status).toBe(422);

    await call('POST', `/v1/deals/${charlie.otherDeal}/invitations`, { email: 'advisor@law.example', side: 'ADVISOR', role: 'ADVISER' }, lead);
    const token = tokenFrom(await lastMail('advisor@law.example'));
    const [pending] = (await call('GET', `/v1/deals/${charlie.otherDeal}/invitations`, undefined, lead)).body['items'] as Body[];
    expect((await call('POST', `/v1/deals/${charlie.otherDeal}/invitations/${pending?.['id']}/revoke`, undefined, lead)).status).toBe(204);
    expect((await call('GET', `/v1/invitations/${token}`)).body).toMatchObject({ status: 'REVOKED' });
  });
});
