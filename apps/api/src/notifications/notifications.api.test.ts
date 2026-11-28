import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import type { EmailSender, OutboundEmail } from '../email-login/email-sender';
import { recipientHash } from '../email-events/email-events.service';
import { NotificationDispatcher } from './notification-dispatcher';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const SECRET = 'notification-test-secret-at-least-32-characters';

class RecordingSender implements EmailSender {
  readonly name = 'recording';
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail) {
    this.sent.push(message);
  }
  to(address: string) {
    return this.sent.filter((message) => message.to === address);
  }
}

type Item = { id: string; type: string; urgency: string; title: string; dealName: string; link: string; readAt: string | null; emailStatus: string };
type Page = { items: Item[]; nextCursor: string | null; total: number; limit: number };

/**
 * T-145 acceptance: a counter-proposal reaches the other side's lead in the app and by one email at
 * once; a seller's upload reaches the buyer team's daily digest, never an immediate email unless
 * chosen; a target contributor never hears of buyer-only findings; quiet hours delay a send; a
 * retry never sends twice; a suppressed address is never emailed.
 */
describe('pact activity notifications (T-145)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  let dispatcher: NotificationDispatcher;
  const sender = new RecordingSender();
  const tokens: Record<string, string> = {};
  const address = { lead: 'lead@buyer.test', analyst: 'analyst@buyer.test', seller: 'seller@target.test' };

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]!}`, ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { payload: JSON.stringify(payload) } : {}) });
    return { status: response.statusCode, body: response.json() as Record<string, unknown>, text: response.body };
  }
  const deal = (path: string) => `/v1/deals/${a.dealId}${path}`;
  const inbox = async (who: string, query = '') => (await call(who, 'GET', `/v1/notifications${query}`)).body as unknown as Page;
  const types = async (who: string) => (await inbox(who)).items.map((item) => item.type);
  const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000);
  const tomorrowAt = (hour: number) => {
    const day = new Date(Date.now() + 86_400_000);
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, 1));
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Notify');
    const b = await createSyntheticTenant(db.owner, 'Notify other org');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner() },
      emailLogin: { tokenSecret: SECRET, emailSender: sender },
    });
    await app.init();
    dispatcher = app.get(NotificationDispatcher);
    const analyst = await addSyntheticDealMember(db.owner, a, 'ANALYST');
    const seller = await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR');
    for (const [id, email] of [[a.userId, address.lead], [analyst.userId, address.analyst], [seller.userId, address.seller]] as const) {
      await db.owner.query('UPDATE users SET email = $1 WHERE id = $2', [email, id]);
    }
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    tokens['analyst'] = await token(analyst.subject, a.auth0OrganizationId);
    tokens['seller'] = await token(seller.subject, a.auth0OrganizationId);
    tokens['other'] = await token(b.subject, b.auth0OrganizationId);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('a counter-proposal: one in-app item and one immediate email to the other side, nothing to anyone without access', async () => {
    const drafted = await call('seller', 'POST', deal('/terms/drafts'), { currency: 'USD', terms: [{ lever: 'PURCHASE_PRICE', amount: '40000000.00', note: 'Asking.' }] });
    expect(drafted.status, drafted.text).toBe(201);
    await call('seller', 'POST', deal(`/terms/${(drafted.body['draft'] as { id: string }).id}/propose`));
    // The seller's proposal is for the buyer's deal lead; the analyst is not asked.
    expect(await types('lead')).toEqual(['TERMS_PROPOSED']);
    expect(await types('analyst')).toEqual([]);

    const countered = await call('lead', 'POST', deal('/terms/proposed/responses'), { responses: [{ ordinal: 0, decision: 'COUNTER', counterAmount: '35000000.00', note: 'Our view.' }] });
    expect(countered.status, countered.text).toBe(201);
    const seller = await inbox('seller');
    expect(seller.items.map((item) => [item.type, item.urgency])).toEqual([['TERMS_COUNTERED', 'ACT_NOW']]);
    expect(seller.items[0]).toMatchObject({ dealName: a.dealName, link: `/deals/${a.dealId}/terms` });
    expect((await inbox('analyst')).total).toBe(0);
    expect((await inbox('other')).total).toBe(0);

    const outcome = await dispatcher.run();
    expect(outcome.sent).toBe(2);
    const [email] = sender.to(address.seller);
    expect(sender.to(address.seller)).toHaveLength(1);
    expect(email!.subject).toContain(a.dealName);
    expect(email!.text).toContain(`/deals/${a.dealId}/terms`);
    // Never an amount, a note or any document text.
    for (const message of sender.sent) expect(`${message.subject}\n${message.text}`).not.toMatch(/35000000|40000000|Our view|Asking/);
    expect(sender.to(address.analyst)).toHaveLength(0);
    expect((await inbox('seller')).items[0]?.emailStatus).toBe('SENT');
  });

  it('a retry never sends twice', async () => {
    const before = sender.sent.length;
    await Promise.all([dispatcher.run(), dispatcher.run()]);
    await dispatcher.run();
    expect(sender.sent.length).toBe(before);
  });

  it('a seller’s upload goes in the buyer team’s daily digest, never as an immediate email', async () => {
    const before = sender.sent.length;
    const uploaded = await call('seller', 'POST', deal('/documents'), { fileName: 'customer list.txt', contentType: 'text/plain', contentBase64: Buffer.from('Top customers: Acme (synthetic)').toString('base64') });
    expect(uploaded.status, uploaded.text).toBe(201);
    expect(await types('analyst')).toEqual(['DOCUMENT_ADDED']);
    expect((await inbox('analyst')).items[0]?.urgency).toBe('FYI');
    // The uploader is not told of their own upload.
    expect(await types('seller')).toEqual(['TERMS_COUNTERED']);

    await dispatcher.run();
    expect(sender.sent.length).toBe(before);
    // Tomorrow's 08:00 slot: one digest each for the lead and the analyst; the address is suppressed for neither yet.
    await db.owner.query(`INSERT INTO email_suppressions (recipient_hash, reason) VALUES ($1, 'HARD_BOUNCE')`, [recipientHash(SECRET, address.analyst)]);
    const outcome = await dispatcher.run(tomorrowAt(8));
    expect(outcome.digests).toBe(1);
    expect(outcome.suppressed).toBe(1);
    const digest = sender.to(address.lead).at(-1)!;
    expect(digest.subject).toMatch(/digest/i);
    expect(digest.text).toContain('The other side added a document');
    expect(digest.text).not.toContain('Acme');
    // A suppressed address is never emailed; the item says so.
    expect(sender.to(address.analyst)).toHaveLength(0);
    expect((await inbox('analyst')).items[0]?.emailStatus).toBe('SUPPRESSED');
  });

  it('sends a document at once to someone who chose that for this pact', async () => {
    const set = await call('lead', 'PUT', deal('/notification-settings'), { actNow: null, fyi: 'EMAIL_NOW' });
    expect(set.status, set.text).toBe(200);
    expect((await call('other', 'PUT', deal('/notification-settings'), { actNow: null, fyi: 'EMAIL_NOW' })).status).toBe(404);
    const before = sender.to(address.lead).length;
    await call('seller', 'POST', deal('/documents'), { fileName: 'second.txt', contentType: 'text/plain', contentBase64: Buffer.from('Second file').toString('base64') });
    await dispatcher.run();
    expect(sender.to(address.lead)).toHaveLength(before + 1);
    expect(sender.to(address.lead).at(-1)?.subject).toContain('The other side added a document');
  });

  it('never tells a target contributor of a buyer-only finding, and tells the buyer team', async () => {
    const created = await call('lead', 'POST', deal('/findings'), { domain: 'FINANCIAL', title: 'Revenue concentration', description: 'Top customer is 40% of revenue.', severity: 'HIGH', confidence: 'MEDIUM' });
    expect(created.status, created.text).toBe(201);
    expect(await types('analyst')).toContain('FINDING_DRAFTED');
    expect((await inbox('analyst')).items.find((item) => item.type === 'FINDING_DRAFTED')?.link).toBe(`/deals/${a.dealId}/findings/${created.body['id'] as string}`);
    expect(await types('seller')).not.toContain('FINDING_DRAFTED');
    await dispatcher.run(tomorrowAt(23));
    expect(sender.to(address.seller).some((message) => message.text.includes('finding'))).toBe(false);
  });

  it('writes the email in the pact working language when it has one (T-174b)', async () => {
    expect((await call('lead', 'PATCH', `/v1/deals/${a.dealId}`, { workingLanguage: 'ja' })).status).toBe(200);
    const before = sender.to(address.lead).length;
    await call('seller', 'POST', deal('/documents'), { fileName: 'third.txt', contentType: 'text/plain', contentBase64: Buffer.from('Third file').toString('base64') });
    await dispatcher.run();
    const email = sender.to(address.lead).at(-1);
    expect(sender.to(address.lead)).toHaveLength(before + 1);
    expect(email).toMatchObject({ locale: 'ja' });
    expect(email!.subject).toContain('相手方が文書を追加しました');
    expect((await call('lead', 'PATCH', `/v1/deals/${a.dealId}`, { workingLanguage: null })).status).toBe(200);
  });

  it('quiet hours delay an act-now email until they end', async () => {
    const minute = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
    const quiet = { quietStart: (minute + 1440 - 60) % 1440, quietEnd: (minute + 60) % 1440 };
    const saved = await call('lead', 'PUT', '/v1/notification-settings', { actNow: 'EMAIL_NOW', fyi: 'EMAIL_DIGEST', digest: 'DAILY', timeZone: 'UTC', ...quiet, actNowThroughQuiet: false });
    expect(saved.status, saved.text).toBe(200);
    expect((await call('lead', 'PUT', '/v1/notification-settings', { actNow: 'EMAIL_NOW', fyi: 'EMAIL_DIGEST', digest: 'DAILY', timeZone: 'Mars/Olympus', quietStart: null, quietEnd: null, actNowThroughQuiet: false })).status).toBe(422);
    // The seller takes the counter into a new version and proposes it: an act-now item for the lead.
    const view = (await call('seller', 'GET', deal('/terms/proposed'))).body['proposed'] as { id: string };
    const next = await call('seller', 'POST', deal(`/terms/${view.id}/accept-counters`));
    expect(next.status, next.text).toBe(201);
    const draft = (next.body['draft'] as { id: string }).id;
    await call('seller', 'POST', deal(`/terms/${draft}/propose`));
    const before = sender.to(address.lead).length;
    await dispatcher.run();
    expect(sender.to(address.lead)).toHaveLength(before);
    await dispatcher.run(hoursFromNow(2));
    expect(sender.to(address.lead)).toHaveLength(before + 1);
    expect(sender.to(address.lead).at(-1)?.subject).toContain('New terms are waiting for your answer');
  });

  it('marks items read, one or all, and pages the inbox', async () => {
    const first = await inbox('lead', '?limit=1');
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const rest = await inbox('lead', `?limit=100&cursor=${first.nextCursor!}`);
    expect(rest.items.some((item) => item.id === first.items[0]!.id)).toBe(false);
    const unread = (await call('lead', 'GET', '/v1/notifications/unread-count')).body['count'] as number;
    expect(unread).toBe(first.total);
    expect((await call('lead', 'POST', `/v1/notifications/${first.items[0]!.id}/read`)).body).toEqual({ read: true, unread: unread - 1 });
    // Someone else's item cannot be marked.
    expect((await call('seller', 'POST', `/v1/notifications/${first.items[0]!.id}/read`)).body['read']).toBe(false);
    expect((await call('lead', 'POST', '/v1/notifications/read-all')).body['unread']).toBe(0);
    expect((await inbox('lead', '?unread=true')).total).toBe(0);
  });
});
