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

/**
 * Public deal page: a seller publishes a teaser; a signed-out visitor requests access and
 * confirms their email; only then does the seller see it, and approving makes their firm a
 * bidder with an invitation. Nothing of the pact itself is ever public.
 */
describe('public deal page (listing)', { timeout: 60_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  const mail = new CapturingEmailSender();
  const seller = { organizationId: newId(), lead: newId() };
  const other = { organizationId: newId(), lead: newId() };
  let lead = '';
  let dealId = '';
  let slug = '';

  async function call(method: 'GET' | 'POST' | 'PUT', url: string, payload?: Body, bearer?: string, headers: Record<string, string> = {}) {
    const response = await app.inject({ method, url, headers: { ...headers, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  const mailTo = (to: string) => mail.sent.filter((message) => message.to === to);
  async function signIn(email: string) {
    const before = mail.sent.length;
    expect((await call('POST', '/v1/auth/email/start', { email })).status).toBe(202);
    for (let i = 0; i < 100 && mail.sent.length === before; i += 1) await new Promise((r) => setTimeout(r, 10));
    const code = /\b(\d{6})\b/.exec(mail.sent.at(-1)?.text ?? '')?.[1];
    return (await call('POST', '/v1/auth/email/verify', { email, code })).body['token'] as string;
  }
  const request = (email: string, extra: Body = {}, ip = '203.0.113.7') =>
    call('POST', `/v1/public/listings/${slug}/interest`, { name: 'Ari Buyer', firm: 'Synthetic Capital', email, intent: 'FINANCIAL', message: 'We buy workflow SaaS.', ...extra }, undefined, { 'x-pactlab-client-ip': ip });
  const confirmToken = (to: string) => /\/listings\/confirm\/([A-Za-z0-9_-]{43})/.exec(mailTo(to).at(-1)?.text ?? '')?.[1] ?? '';

  beforeAll(async () => {
    db = await startTestDatabase();
    const q = (sql: string, params: unknown[]) => db.owner.query(sql, params);
    for (const [org, user, name, email] of [
      [seller.organizationId, seller.lead, 'Brightwave (synthetic)', 'lead@brightwave.example'],
      [other.organizationId, other.lead, 'Elsewhere (synthetic)', 'lead@elsewhere.example'],
    ] as const) {
      await q(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', now())`, [org, name, `org-${org.slice(-8)}`]);
      await q(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [user, `pactlab|${user}`, name, email]);
      await q(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'ORG_ADMIN')`, [newId(), org, user]);
    }
    const pair = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: 'https://pactlab-test.example/', audience: 'https://api.pactlab.test', keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: process.env['DEBUG_API'] ? 'error' : 'silent' }),
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
      signup: { requiresApproval: true, loginUrl: 'https://app.pactlab.test/login' },
    });
    lead = await signIn('lead@brightwave.example');
    const pact = await call('POST', '/v1/pacts', { name: 'Brightwave sale', baseCurrency: 'USD', initiatedBy: 'SELLER', seller: { name: 'Brightwave Software Inc. (synthetic)', ownership: 'PRIVATE', companyType: 'SOFTWARE_SAAS' } }, lead);
    expect(pact.status, JSON.stringify(pact.body)).toBe(201);
    dealId = pact.body['id'] as string;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('the seller writes an anonymous teaser; it is public only once published, and never names the pact', async () => {
    expect((await call('GET', `/v1/deals/${dealId}/listing`, undefined, lead)).body).toEqual({ listing: null });
    const teaser = { visibility: 'ANONYMOUS', codename: 'Project Atlas', headline: 'Profitable workflow SaaS for logistics firms', sector: 'Software & SaaS', region: 'North America', sizeBand: 'USD 5–10M ARR', askingLow: '40000000', askingHigh: '55000000', askingCurrency: 'USD', summary: 'Synthetic teaser.', highlights: ['Net revenue retention above 110%', 'Founder-led'] };
    // A named page needs a name to show.
    expect((await call('PUT', `/v1/deals/${dealId}/listing`, { ...teaser, visibility: 'NAMED' }, lead)).status).toBe(400);
    const saved = await call('PUT', `/v1/deals/${dealId}/listing`, { ...teaser, publicName: 'ignored when anonymous' }, lead);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const listing = saved.body['listing'] as Body;
    expect(listing).toMatchObject({ status: 'DRAFT', visibility: 'ANONYMOUS', publicName: null, asking: { low: '40000000', high: '55000000', currency: 'USD' } });
    slug = listing['slug'] as string;
    expect(slug).toMatch(/^pl-[a-z0-9]{10}$/);

    expect((await call('GET', `/v1/public/listings/${slug}`)).status).toBe(404);
    expect((await call('PUT', `/v1/deals/${dealId}/listing/status`, { status: 'PUBLISHED' }, lead)).body['listing']).toMatchObject({ status: 'PUBLISHED' });
    const open = await call('GET', `/v1/public/listings/${slug}`);
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({ codename: 'Project Atlas', publicName: null, highlights: ['Net revenue retention above 110%', 'Founder-led'] });
    for (const secret of [dealId, 'Brightwave', 'Brightwave sale']) expect(JSON.stringify(open.body)).not.toContain(secret);
  });

  it('another organization and a signed-out caller cannot run it', async () => {
    const elsewhere = await signIn('lead@elsewhere.example');
    expect((await call('GET', `/v1/deals/${dealId}/listing`, undefined, elsewhere)).status).toBe(404);
    expect((await call('GET', `/v1/deals/${dealId}/listing/interests`, undefined, elsewhere)).status).toBe(404);
    expect((await call('GET', `/v1/deals/${dealId}/listing`)).status).toBe(401);
  });

  it('a request reaches the seller only after its email is confirmed; duplicates and bots get the same answer', async () => {
    expect(await request('Ari.Buyer@example.com')).toEqual({ status: 202, body: { status: 'CHECK_EMAIL' } });
    await settle();
    expect(mailTo('ari.buyer@example.com')).toHaveLength(1);
    expect(mailTo('ari.buyer@example.com')[0]?.text).toContain('Project Atlas');
    // The same person again while it is open, and a bot filling the honeypot: same answer, no email.
    expect(await request('ari.buyer@example.com')).toEqual({ status: 202, body: { status: 'CHECK_EMAIL' } });
    expect(await request('bot@example.com', { website: 'http://spam.example' })).toEqual({ status: 202, body: { status: 'CHECK_EMAIL' } });
    await settle();
    expect(mailTo('ari.buyer@example.com')).toHaveLength(1);
    expect(mailTo('bot@example.com')).toHaveLength(0);

    expect((await call('GET', `/v1/deals/${dealId}/listing/interests`, undefined, lead)).body).toEqual({ items: [] });
    const token = confirmToken('ari.buyer@example.com');
    expect(await call('POST', '/v1/public/listing-interest/confirm', { token })).toEqual({ status: 200, body: { slug } });
    expect((await call('POST', '/v1/public/listing-interest/confirm', { token })).status).toBe(404);
    const inbox = (await call('GET', `/v1/deals/${dealId}/listing/interests`, undefined, lead)).body['items'] as Body[];
    expect(inbox).toEqual([expect.objectContaining({ name: 'Ari Buyer', firm: 'Synthetic Capital', email: 'ari.buyer@example.com', intent: 'FINANCIAL', status: 'NEW' })]);
    const audit = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE deal_id = $1 AND action = 'listing.interest.received'`, [dealId]);
    expect(audit.rows[0]?.n).toBe(1);
  });

  it('approving makes the firm a bidder and invites them under the codename, once', async () => {
    const [interest] = (await call('GET', `/v1/deals/${dealId}/listing/interests`, undefined, lead)).body['items'] as Body[];
    const approved = await call('POST', `/v1/deals/${dealId}/listing/interests/${interest?.['id']}/approve`, undefined, lead);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const bidId = (approved.body['interest'] as Body)['bidId'];
    expect(approved.body['interest']).toMatchObject({ status: 'APPROVED', bidId: expect.any(String) });
    const board = (await call('GET', `/v1/deals/${dealId}/sale`, undefined, lead)).body['bids'] as Body[];
    expect(board.map((bid) => [bid['id'], bid['firmName']])).toEqual([[bidId, 'Synthetic Capital']]);
    await settle();
    const invite = mailTo('ari.buyer@example.com').at(-1)?.text ?? '';
    expect(invite).toContain('/invite/');
    expect(invite).toContain('Project Atlas');
    expect(invite).not.toContain('Brightwave sale');
    // Again: nothing changes.
    expect((await call('POST', `/v1/deals/${dealId}/listing/interests/${interest?.['id']}/approve`, undefined, lead)).body['interest']).toMatchObject({ status: 'APPROVED', bidId });
    expect(((await call('GET', `/v1/deals/${dealId}/sale`, undefined, lead)).body['bids'] as Body[]).length).toBe(1);
  });

  it('declining tells the requester, with the seller\'s note', async () => {
    expect((await request('second@example.com', { firm: 'Other Fund' }, '203.0.113.8')).status).toBe(202);
    await settle();
    expect((await call('POST', '/v1/public/listing-interest/confirm', { token: confirmToken('second@example.com') })).status).toBe(200);
    const item = ((await call('GET', `/v1/deals/${dealId}/listing/interests`, undefined, lead)).body['items'] as Body[]).find((entry) => entry['email'] === 'second@example.com');
    const declined = await call('POST', `/v1/deals/${dealId}/listing/interests/${item?.['id']}/decline`, { note: 'Strategic buyers only.' }, lead);
    expect(declined.body['interest']).toMatchObject({ status: 'DECLINED', decisionNote: 'Strategic buyers only.' });
    await settle();
    expect(mailTo('second@example.com').at(-1)?.text).toContain('Strategic buyers only.');
    expect((await call('POST', `/v1/deals/${dealId}/listing/interests/${item?.['id']}/approve`, undefined, lead)).status).toBe(409);
  });

  it('closing the page takes it offline', async () => {
    expect((await call('PUT', `/v1/deals/${dealId}/listing/status`, { status: 'CLOSED' }, lead)).status).toBe(200);
    expect((await call('GET', `/v1/public/listings/${slug}`)).status).toBe(404);
    expect((await request('late@example.com', {}, '203.0.113.9')).status).toBe(404);
    const actions = (await db.owner.query<{ action: string }>(`SELECT action FROM audit_events WHERE deal_id = $1 AND action LIKE 'listing.%' ORDER BY chain_seq`, [dealId])).rows.map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['listing.saved', 'listing.published', 'listing.interest.received', 'listing.interest.approved', 'listing.interest.declined', 'listing.closed']));
  });
});
