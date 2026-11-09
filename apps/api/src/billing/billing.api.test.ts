import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FixtureBillingProvider } from '@pactlab/connectors';
import { startTestDatabase, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { DisabledIdentityVerifier } from '../auth/identity';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';

const SECRET = 'billing-test-secret-'.padEnd(48, 'x');
type Body = Record<string, unknown>;

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

/** T-087: buy, subscribe, enforce, replay-safety, promo codes and operators, through the API (fixture Stripe). */
describe('billing and promo codes', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  const mail = new CapturingEmailSender();
  const provider = new FixtureBillingProvider('whsec_billing_test', 'http://localhost:3000/billing/fixture-checkout');
  const sessions = new Map<string, string>();

  async function call(method: 'GET' | 'POST', url: string, payload?: Body | string, bearer?: string, headers: Record<string, string> = {}) {
    const response = await app.inject({ method, url, headers: { ...headers, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, ...(payload !== undefined ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  async function codeFor(email: string, path: string, payload: Body) {
    const before = mail.sent.length;
    await call('POST', path, payload);
    for (let i = 0; i < 50 && mail.sent.length === before; i += 1) await new Promise((r) => setTimeout(r, 10));
    return /\b(\d{6})\b/.exec(mail.sent.at(-1)?.text ?? '')?.[1] ?? '';
  }

  async function signIn(email: string): Promise<string> {
    const known = sessions.get(email);
    if (known) return known;
    const code = await codeFor(email, '/v1/auth/email/start', { email });
    const token = (await call('POST', '/v1/auth/email/verify', { email, code })).body['token'] as string;
    sessions.set(email, token);
    return token;
  }

  async function organization(label: string, role = 'ORG_OWNER') {
    const organizationId = newId();
    const userId = newId();
    const email = `${label.toLowerCase()}@billing.example`;
    await db.owner.query(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', now())`, [organizationId, `${label} (synthetic)`, `${label.toLowerCase()}-${organizationId.slice(-8)}`]);
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [userId, `pactlab|${userId}`, `${label} (synthetic)`, email]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)`, [newId(), organizationId, userId, role]);
    return { organizationId, userId, email };
  }

  const startPact = (token: string, companyType = 'SOFTWARE_SAAS') =>
    call('POST', '/v1/pacts', { name: `Pact ${newId().slice(-6)}`, baseCurrency: 'USD', buyer: { name: 'Buyer (synthetic)', ownership: 'PRIVATE' }, seller: { name: 'Target (synthetic)', ownership: 'PRIVATE', companyType } }, token);

  async function pay(token: string, plan: string) {
    const checkout = await call('POST', '/v1/billing/checkout', { plan }, token);
    expect(checkout.status, JSON.stringify(checkout.body)).toBe(200);
    const session = new URL(checkout.body['url'] as string).searchParams.get('session') ?? '';
    return { session, request: provider.session(session) };
  }
  const webhook = (delivery: { payload: string; signature: string }) => call('POST', '/v1/webhooks/stripe', delivery.payload, undefined, { 'content-type': 'application/json', 'stripe-signature': delivery.signature });

  beforeAll(async () => {
    db = await startTestDatabase();
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new DisabledIdentityVerifier(),
      logger: createLogger('api-test', { level: 'silent' }),
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
      signup: { requiresApproval: true, operatorEmail: null, loginUrl: 'http://localhost:3000/login' },
      billing: { provider, enforce: true },
    });
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('buy a pact: checkout, the paid event grants one credit, a replay grants nothing, the pact uses it', async () => {
    const ana = await organization('Ana');
    const token = await signIn(ana.email);
    expect((await call('GET', '/v1/billing', undefined, token)).body).toMatchObject({ status: 'NONE', enforced: true, credits: [], canManage: true });
    expect((await startPact(token)).body).toMatchObject({ code: 'PAYMENT_REQUIRED' });
    const { session } = await pay(token, 'PACT');
    const [delivery] = provider.complete(session);
    expect((await webhook(delivery!)).status).toBe(200);
    expect((await webhook(delivery!)).status).toBe(200);
    expect(((await call('GET', '/v1/billing', undefined, token)).body['credits'] as unknown[]).length).toBe(1);
    const started = await startPact(token);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const [deal] = (await db.owner.query(`SELECT live_until FROM deals WHERE id = $1`, [started.body['id']])).rows as { live_until: string }[];
    expect(new Date(deal!.live_until).getTime() - Date.now()).toBeGreaterThan(360 * 86_400_000);
    expect((await startPact(token)).body).toMatchObject({ code: 'PAYMENT_REQUIRED' });
  });

  it('an unsigned or tampered webhook is refused and changes nothing', async () => {
    const delivery = provider.sign('checkout.session.completed', { id: 'cs_x', mode: 'payment', payment_status: 'paid', client_reference_id: newId(), metadata: { planKey: 'PACT' } });
    expect((await webhook({ payload: delivery.payload, signature: 't=1,v1=deadbeef' })).status).toBe(400);
    expect((await webhook({ payload: delivery.payload.replace('PACT', 'TEAM_ANNUAL'), signature: delivery.signature })).status).toBe(400);
  });

  it('Team: 10 pacts a period, then a credit is needed; past due blocks new pacts but never existing ones', async () => {
    const team = await organization('Team');
    const token = await signIn(team.email);
    const { session } = await pay(token, 'TEAM_ANNUAL');
    for (const delivery of provider.complete(session)) expect((await webhook(delivery)).status).toBe(200);
    const billing = (await call('GET', '/v1/billing', undefined, token)).body;
    expect(billing).toMatchObject({ status: 'ACTIVE', plan: { key: 'TEAM_ANNUAL' }, allowanceLeft: 10, hasCustomer: true });
    let first = '';
    for (let i = 0; i < 10; i += 1) {
      const started = await startPact(token);
      expect(started.status).toBe(201);
      first ||= started.body['id'] as string;
    }
    expect((await call('GET', '/v1/billing', undefined, token)).body['allowanceLeft']).toBe(0);
    expect((await startPact(token)).body).toMatchObject({ code: 'PAYMENT_REQUIRED' });
    const [account] = (await db.owner.query(`SELECT subscription_id FROM billing_accounts WHERE organization_id = $1`, [team.organizationId])).rows as { subscription_id: string }[];
    expect((await webhook(provider.setStatus(account!.subscription_id, 'past_due'))).status).toBe(200);
    expect((await call('GET', '/v1/billing', undefined, token)).body['status']).toBe('PAST_DUE');
    expect((await call('GET', `/v1/deals/${first}`, undefined, token)).status).toBe(200);
    expect((await call('POST', '/v1/billing/portal', {}, token)).status).toBe(200);
  });

  it('a pilot organization is never asked to pay; members (not admins) cannot buy', async () => {
    const pilot = await organization('Pilot');
    await db.owner.query(`INSERT INTO organization_flags (organization_id, pilot_mode) VALUES ($1, true)`, [pilot.organizationId]);
    expect((await startPact(await signIn(pilot.email))).status).toBe(201);
    const member = await organization('Member', 'MEMBER');
    expect((await call('POST', '/v1/billing/checkout', { plan: 'PACT' }, await signIn(member.email))).status).toBe(403);
  });

  it('promo codes: only operators make them; a free-pact code at sign-up skips approval and grants pack-limited pacts', async () => {
    const ops = await organization('Ops');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [ops.userId]);
    const opsToken = await signIn(ops.email);
    const outsider = await signIn((await organization('Outsider')).email);
    const freePacts = { code: 'MF-LAUNCH-2026', description: 'Multifamily launch', kind: 'FREE_PACTS', freePacts: 2, packs: ['MULTIFAMILY'], maxRedemptions: 5 };
    expect((await call('POST', '/v1/admin/promo-codes', freePacts, outsider)).status).toBe(403);
    const created = await call('POST', '/v1/admin/promo-codes', freePacts, opsToken);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((created.body['items'] as { code: string; summary: string }[]).find((item) => item.code === 'MF-LAUNCH-2026')?.summary).toBe('2 free pacts (Multifamily)');

    expect((await call('POST', '/v1/billing/promo/check', { code: 'mf-launch-2026' })).body).toMatchObject({ valid: true, skipsApproval: true, summary: '2 free pacts (Multifamily)' });
    expect((await call('POST', '/v1/billing/promo/check', { code: 'NOPE-NOPE' })).body).toMatchObject({ valid: false, reason: 'UNKNOWN' });

    // Sign up with the code: active at once (no approval), signed in, two Multifamily pacts.
    const email = 'founder@newfirm.example';
    const code = await codeFor(email, '/v1/signup/start', { email, displayName: 'New Firm Lead', organizationName: 'New Firm (synthetic)' });
    const verified = await call('POST', '/v1/signup/verify', { email, code, promoCode: 'MF-LAUNCH-2026' });
    expect(verified.status, JSON.stringify(verified.body)).toBe(201);
    expect(verified.body).toMatchObject({ status: 'ACTIVE' });
    const token = (verified.body['session'] as { token: string }).token;
    expect(((await call('GET', '/v1/billing', undefined, token)).body['credits'] as unknown[]).length).toBe(2);
    expect((await startPact(token, 'HOTELS')).body).toMatchObject({ code: 'PAYMENT_REQUIRED' });
    expect((await startPact(token, 'MULTIFAMILY')).status).toBe(201);
    // Redeeming the same code again for that organization is refused.
    expect((await call('POST', '/v1/billing/promo', { code: 'MF-LAUNCH-2026' }, token)).body).toMatchObject({ code: 'PROMO_ALREADY' });
    // An invalid code at sign-up says so.
    const other = 'second@newfirm2.example';
    const code2 = await codeFor(other, '/v1/signup/start', { email: other, displayName: 'Second', organizationName: 'Second Firm (synthetic)' });
    expect((await call('POST', '/v1/signup/verify', { email: other, code: code2, promoCode: 'EXPIRED-X' })).body).toMatchObject({ code: 'PROMO_UNKNOWN' });
  });

  it('a discount code is mirrored to Stripe and applied at checkout', async () => {
    const opsToken = await signIn('ops@billing.example');
    const created = await call('POST', '/v1/admin/promo-codes', { code: 'PARTNER50', description: 'Design partners', kind: 'DISCOUNT', percentOff: '50', duration: 'REPEATING', durationMonths: 12, planKeys: ['TEAM_ANNUAL'] }, opsToken);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const partner = (created.body['items'] as { code: string; stripeLinked: boolean; summary: string }[]).find((item) => item.code === 'PARTNER50');
    expect(partner).toMatchObject({ stripeLinked: true, summary: '50% off for 12 months' });
    const firm = await organization('Partner');
    const token = await signIn(firm.email);
    expect((await call('POST', '/v1/billing/promo', { code: 'partner50' }, token)).body).toMatchObject({ pendingPromo: 'PARTNER50' });
    expect((await pay(token, 'TEAM_ANNUAL')).request?.promotionCodeId).toMatch(/^promo_fixture_/);
    expect((await pay(token, 'PACT')).request?.promotionCodeId).toBeNull();
  });

  it('operators see accounts, comp a pact (audited) and resync a corrupted mirror from Stripe', async () => {
    const opsToken = await signIn('ops@billing.example');
    const team = await db.owner.query(`SELECT organization_id FROM billing_accounts WHERE subscription_id IS NOT NULL LIMIT 1`);
    const organizationId = (team.rows[0] as { organization_id: string }).organization_id;
    await db.owner.query(`UPDATE billing_accounts SET status = 'CANCELED' WHERE organization_id = $1`, [organizationId]);
    expect((await call('POST', `/v1/admin/organizations/${organizationId}/billing/resync`, {}, opsToken)).body).toEqual({ resynced: true });
    // The fixture subscription was set past due above; the mirror follows Stripe, not the corruption.
    expect(((await db.owner.query(`SELECT status FROM billing_accounts WHERE organization_id = $1`, [organizationId])).rows[0] as { status: string }).status).toBe('PAST_DUE');
    const cy = await organization('Cy');
    expect((await call('POST', `/v1/admin/organizations/${cy.organizationId}/billing/comp`, { kind: 'PACT' }, opsToken)).status).toBe(201);
    expect((await startPact(await signIn(cy.email))).status).toBe(201);
    expect(((await call('GET', '/v1/admin/billing', undefined, opsToken)).body['items'] as unknown[]).length).toBeGreaterThan(0);
    expect((await call('GET', '/v1/admin/billing', undefined, await signIn(cy.email))).status).toBe(403);
  });
});
