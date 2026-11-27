import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { startTestDatabase, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { DisabledIdentityVerifier } from '../auth/identity';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';

const SECRET = 'pact-pricing-test-secret-'.padEnd(48, 'x');
type Body = Record<string, unknown>;

class CapturingEmailSender implements EmailSender {
  readonly name = 'capture';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
}

/** T-177a acceptance: versioned price books per market, pact promo codes and stored quotes, through the API. */
describe('pact pricing storage', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  const mail = new CapturingEmailSender();
  const sessions = new Map<string, string>();
  let ops = { organizationId: '', userId: '', email: '' };
  let opsToken = '';
  let buyer = '';

  async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: Body, bearer?: string) {
    const response = await app.inject({ method, url, headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, ...(payload !== undefined ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body, raw: response.body };
  }

  async function signIn(email: string): Promise<string> {
    const known = sessions.get(email);
    if (known) return known;
    const before = mail.sent.length;
    await call('POST', '/v1/auth/email/start', { email });
    for (let i = 0; i < 50 && mail.sent.length === before; i += 1) await new Promise((r) => setTimeout(r, 10));
    const code = /\b(\d{6})\b/.exec(mail.sent.at(-1)?.text ?? '')?.[1] ?? '';
    const token = (await call('POST', '/v1/auth/email/verify', { email, code })).body['token'] as string;
    sessions.set(email, token);
    return token;
  }

  async function organization(label: string, role = 'ORG_OWNER') {
    const organizationId = newId();
    const userId = newId();
    const email = `${label.toLowerCase()}-${organizationId.slice(-6)}@pricing.example`;
    await db.owner.query(`INSERT INTO organizations (id, name, slug, auth_method, updated_at) VALUES ($1, $2, $3, 'EMAIL_CODE', now())`, [organizationId, `${label} (synthetic)`, `${label.toLowerCase()}-${organizationId.slice(-8)}`]);
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [userId, `pactlab|${userId}`, `${label} (synthetic)`, email]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)`, [newId(), organizationId, userId, role]);
    return { organizationId, userId, email };
  }

  const quote = (token: string, currency: string, enterpriseValue: string | null, promoCode: string | null = null) => call('POST', '/v1/pricing/quotes', { currency, enterpriseValue, promoCode }, token);
  const liveUsd = async () => (await call('GET', '/v1/pricing/books/USD', undefined, buyer)).body;

  beforeAll(async () => {
    db = await startTestDatabase();
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new DisabledIdentityVerifier(),
      logger: createLogger('api-test', { level: 'silent' }),
      emailLogin: { tokenSecret: SECRET, emailSender: mail },
      signup: { requiresApproval: true, operatorEmail: null, loginUrl: 'http://localhost:3000/login' },
    });
    ops = await organization('Ops');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [ops.userId]);
    opsToken = await signIn(ops.email);
    buyer = await signIn((await organization('Buyer')).email);
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('organizations read the live book; a market with no book refuses a quote; only owners and admins quote', async () => {
    expect(await liveUsd()).toMatchObject({ currency: 'USD', version: 1, status: 'PUBLISHED', fixedFee: '5000.00', variableCap: '50000.00' });
    expect((await call('GET', '/v1/pricing/books/GBP', undefined, buyer)).status).toBe(404);
    expect((await quote(buyer, 'GBP', '1000000')).body).toMatchObject({ code: 'NO_PRICE_BOOK' });
    const member = await signIn((await organization('Member', 'MEMBER')).email);
    expect((await quote(member, 'USD', '1000000')).status).toBe(403);
    expect((await call('GET', '/v1/pricing/books/USD')).status).toBe(401);
  });

  it('publishing a new USD version changes fresh quotes with no deploy; an existing quote re-shows unchanged', async () => {
    const first = await quote(buyer, 'USD', '100000000');
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({ status: 'OPEN', quote: { bookVersion: 1, fixed: '5000.00', total: '32500.00', variable: { amount: '27500.00' } }, price: { total: '32500.00', applied: 'NONE' } });
    const id = first.body['id'] as string;
    const before = (await call('GET', `/v1/pricing/quotes/${id}`, undefined, buyer)).raw;

    const v1 = await liveUsd();
    const draft = await call('POST', '/v1/admin/pricing/books/drafts', { fromVersionId: v1['id'] }, opsToken);
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const book = draft.body;
    const edited = await call('PUT', `/v1/admin/pricing/books/drafts/${draft.body['id']}`, { book: { currency: 'USD', fixedFee: '6000', baseIncludes: book['baseIncludes'], bands: book['bands'], variableCap: book['variableCap'], pilotFlat: book['pilotFlat'], rounding: book['rounding'] } }, opsToken);
    expect(edited.body).toMatchObject({ status: 'DRAFT', version: 2, fixedFee: '6000.00', basedOnVersionId: v1['id'] });
    expect((await call('POST', `/v1/admin/pricing/books/drafts/${draft.body['id']}/preview`, { enterpriseValues: ['100000000'] }, opsToken)).body).toMatchObject({ draft: [{ total: '33500.00' }], live: [{ total: '32500.00' }] });
    const published = await call('POST', `/v1/admin/pricing/books/drafts/${draft.body['id']}/publish`, {}, opsToken);
    expect(published.body).toMatchObject({ status: 'PUBLISHED', version: 2 });

    expect((await quote(buyer, 'USD', '100000000')).body).toMatchObject({ quote: { bookVersion: 2, fixed: '6000.00', total: '33500.00' } });
    expect((await call('GET', `/v1/pricing/quotes/${id}`, undefined, buyer)).raw).toBe(before);
    const outsider = await signIn((await organization('Outsider')).email);
    expect((await call('GET', `/v1/pricing/quotes/${id}`, undefined, outsider)).status).toBe(404);
  });

  it('editing a version that has quoted is refused; a new version is created from it instead', async () => {
    const v2 = await liveUsd();
    expect(v2['firstQuotedAt']).not.toBeNull();
    const body = { currency: 'USD', fixedFee: '1', baseIncludes: v2['baseIncludes'], bands: v2['bands'], variableCap: v2['variableCap'], pilotFlat: v2['pilotFlat'], rounding: v2['rounding'] };
    expect((await call('PUT', `/v1/admin/pricing/books/drafts/${v2['id']}`, { book: body }, opsToken)).body).toMatchObject({ code: 'VERSION_PUBLISHED' });
    expect((await call('DELETE', `/v1/admin/pricing/books/drafts/${v2['id']}`, undefined, opsToken)).body).toMatchObject({ code: 'VERSION_PUBLISHED' });
    const draft = await call('POST', '/v1/admin/pricing/books/drafts', { fromVersionId: v2['id'] }, opsToken);
    expect(draft.body).toMatchObject({ status: 'DRAFT', version: 3, basedOnVersionId: v2['id'] });
    expect((await call('POST', '/v1/admin/pricing/books/drafts', { fromVersionId: v2['id'] }, opsToken)).body).toMatchObject({ code: 'DRAFT_EXISTS' });
    expect((await call('POST', `/v1/admin/pricing/books/drafts/${draft.body['id']}/publish`, { effectiveFrom: '2020-01-01T00:00:00Z' }, opsToken)).body).toMatchObject({ code: 'BACKDATED' });
    expect((await call('DELETE', `/v1/admin/pricing/books/drafts/${draft.body['id']}`, undefined, opsToken)).body).toEqual({ discarded: true });
    const history = await call('GET', '/v1/admin/pricing/books?currency=USD&limit=1', undefined, opsToken);
    expect(history.body).toMatchObject({ total: 2, limit: 1, items: [{ version: 2 }] });
    expect((await call('GET', `/v1/admin/pricing/books?cursor=${history.body['nextCursor']}&limit=1&currency=USD`, undefined, opsToken)).body).toMatchObject({ items: [{ version: 1 }], nextCursor: null });
  });

  it('a JPY-scoped promo applies to a JPY pact and not to a USD one', async () => {
    const usd = await liveUsd();
    const jpy = await call('POST', '/v1/admin/pricing/books/drafts', { suggest: { fromVersionId: usd['id'], currency: 'JPY', rate: '150', rateDate: '2026-11-27', rounding: '1' } }, opsToken);
    expect(jpy.body).toMatchObject({ currency: 'JPY', version: 1, fixedFee: '900000', suggestedFrom: { currency: 'USD', version: 2, rate: '150', rateDate: '2026-11-27' } });
    expect((await call('POST', `/v1/admin/pricing/books/drafts/${jpy.body['id']}/publish`, {}, opsToken)).status).toBe(200);

    const created = await call('POST', '/v1/admin/pricing/promos', { code: 'japan-launch', description: 'Japan launch', effect: 'PERCENT_TOTAL', percent: '20', markets: ['JPY'] }, opsToken);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ code: 'JAPAN-LAUNCH', status: 'ACTIVE', markets: ['JPY'], redemptions: 0 });

    const yen = await quote(buyer, 'JPY', '15000000000', 'JAPAN-LAUNCH');
    expect(yen.status, JSON.stringify(yen.body)).toBe(201);
    expect(yen.body).toMatchObject({ price: { currency: 'JPY', applied: 'PROMO', promo: { code: 'JAPAN-LAUNCH', applied: true, refusal: null } } });
    const yenPrice = yen.body['price'] as { subtotal: string; total: string };
    expect(Number(yenPrice.total)).toBe(Number(yenPrice.subtotal) * 0.8);

    const dollars = await quote(buyer, 'USD', '100000000', 'JAPAN-LAUNCH');
    expect(dollars.body).toMatchObject({ price: { applied: 'NONE', total: '33500.00', promo: { code: 'JAPAN-LAUNCH', applied: false, refusal: 'WRONG_MARKET' } } });
    expect((await quote(buyer, 'USD', '100000000', 'NO-SUCH-CODE')).body).toMatchObject({ code: 'PROMO_UNKNOWN' });
    // An amount is in one currency, so its code is valid only in that market.
    expect((await call('POST', '/v1/admin/pricing/promos', { code: 'YEN-OFF', description: 'x', effect: 'AMOUNT_OFF', amount: '10000', currency: 'JPY', markets: ['USD'] }, opsToken)).status).toBe(400);

    const paused = await call('PATCH', `/v1/admin/pricing/promos/${created.body['id']}`, { status: 'PAUSED' }, opsToken);
    expect(paused.body).toMatchObject({ status: 'PAUSED' });
    expect((await quote(buyer, 'JPY', '15000000000', 'JAPAN-LAUNCH')).body).toMatchObject({ code: 'PROMO_PAUSED' });
    expect((await call('GET', '/v1/admin/pricing/promos?limit=10', undefined, opsToken)).body).toMatchObject({ total: 1, items: [{ code: 'JAPAN-LAUNCH' }] });
    expect((await call('GET', `/v1/admin/pricing/promos/${created.body['id']}/redemptions`, undefined, opsToken)).body).toMatchObject({ total: 0, items: [] });
  });

  it('a pilot organization quotes the flat pilot price at any size', async () => {
    const pilot = await organization('Pilot');
    await db.owner.query(`INSERT INTO organization_flags (organization_id, pilot_mode) VALUES ($1, true)`, [pilot.organizationId]);
    expect((await quote(await signIn(pilot.email), 'USD', '900000000')).body).toMatchObject({ quote: { pilot: true, enterpriseValue: null, total: '5000.00' }, price: { total: '5000.00' } });
  });

  it('only operators manage books and promos; the audit log shows every book and promo change', async () => {
    for (const [method, url, payload] of [
      ['GET', '/v1/admin/pricing/books', undefined],
      ['POST', '/v1/admin/pricing/books/drafts', { fromVersionId: (await liveUsd())['id'] }],
      ['GET', '/v1/admin/pricing/promos', undefined],
      ['POST', '/v1/admin/pricing/promos', { code: 'SNEAKY-1', description: 'x', effect: 'WAIVE_VARIABLE' }],
    ] as const) {
      expect((await call(method, url, payload, buyer)).status, `${method} ${url}`).toBe(403);
    }
    const actions = (await db.owner.query(`SELECT action FROM audit_events WHERE organization_id = $1 AND action LIKE 'pricing.%' ORDER BY chain_seq`, [ops.organizationId])).rows.map((row) => (row as { action: string }).action);
    expect(actions).toEqual([
      'pricing.book_drafted',
      'pricing.book_draft_updated',
      'pricing.book_published',
      'pricing.book_drafted',
      'pricing.book_draft_discarded',
      'pricing.book_drafted',
      'pricing.book_published',
      'pricing.promo_created',
      'pricing.promo_paused',
    ]);
    const quotes = (await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'pricing.quote_created'`)).rows[0] as { n: number };
    expect(quotes.n).toBeGreaterThan(0);
  });
});
