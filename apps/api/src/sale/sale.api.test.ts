import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

type Body = Record<string, unknown>;

const SELLER_PACT = {
  name: 'Project Lighthouse',
  baseCurrency: 'USD',
  initiatedBy: 'SELLER',
  seller: { name: 'Brightwave Software Inc.', ownership: 'PRIVATE', companyType: 'SOFTWARE_SAAS' },
};

/**
 * Seller-led sale (T-097, ADR 0015). The proof that matters: a bidder never
 * sees another bidder — their people, questions, private answers, offers or
 * passes — and never sees the seller's confidential side.
 */
describe('seller-led sale API (T-097)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let seller: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  let dealId = '';
  const bids: Record<string, string> = {};

  async function token(subject: string, org: string) {
    return new SignJWT({ org_id: org })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
  }

  async function call(who: string, method: 'GET' | 'POST' | 'PUT', path: string, payload?: Body) {
    const response = await app.inject({
      method,
      url: path.startsWith('/v1/') ? path : `/v1/deals/${dealId}${path}`,
      headers: { authorization: `Bearer ${tokens[who] ?? ''}` },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() as Body };
  }

  /** A person at a bidding firm: on this pact only, as that firm's bidder. */
  async function addBidder(name: string, bidId: string) {
    const userId = newId();
    const subject = `auth0|bidder-${name}-${userId.slice(-6)}`;
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, $3, $4)`, [userId, subject, `${name} partner`, `${name}@example.test`]);
    await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER')`, [newId(), seller.organizationId, userId]);
    await db.owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role, bid_id) VALUES ($1, $2, $3, $4, 'BIDDER', $5)`, [
      newId(),
      seller.organizationId,
      dealId,
      userId,
      bidId,
    ]);
    tokens[name] = await token(subject, seller.auth0OrganizationId);
    return userId;
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    seller = await createSyntheticTenant(db.owner, 'Brightwave');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner() },
    });
    tokens['seller'] = await token(seller.subject, seller.auth0OrganizationId);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('the seller opens a seller-led pact, with no buyer named yet', async () => {
    const started = await call('seller', 'POST', '/v1/pacts', SELLER_PACT);
    expect(started.status).toBe(201);
    expect(started.body['initiatedBy']).toBe('SELLER');
    dealId = started.body['id'] as string;
    const board = await call('seller', 'GET', '/sale');
    expect(board.body).toMatchObject({ canRun: true, process: { status: 'OPEN', round: 1 }, bids: [] });
    // A buyer-led pact still needs its buyer.
    expect((await call('seller', 'POST', '/v1/pacts', { ...SELLER_PACT, initiatedBy: 'BUYER' })).status).toBe(400);
  });

  it('sets the shared view and NDA, and adds three bidding firms', async () => {
    const updated = await call('seller', 'PUT', '/sale', {
      sharedSummary: 'Brightwave sells workflow software to logistics firms. ARR 7.6m.',
      dataRoomUrl: 'https://dataroom.example.test/brightwave',
      ndaText: 'Mutual NDA (synthetic): keep everything confidential.',
      offerDeadline: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    expect(updated.status).toBe(200);
    for (const firm of ['Harbor Capital', 'Northline Partners', 'Atlas Corp Dev']) {
      const added = await call('seller', 'POST', '/bids', { firmName: firm });
      expect(added.status).toBe(201);
      bids[firm] = added.body['id'] as string;
    }
    expect((await call('seller', 'POST', '/bids', { firmName: 'harbor capital' })).status).toBe(409);
    await addBidder('harbor', bids['Harbor Capital'] as string);
    await addBidder('northline', bids['Northline Partners'] as string);
    await addBidder('atlas', bids['Atlas Corp Dev'] as string);
  });

  it('invites a bidder by email; accepting records their bid on the membership', async () => {
    const invited = await call('seller', 'POST', `/bids/${bids['Atlas Corp Dev']}/invitations`, { email: 'Second.Person@Atlas.example' });
    expect(invited.body).toEqual({ kind: 'INVITED' });
    const row = (await db.owner.query(`SELECT side, role, bid_id FROM deal_invitations WHERE deal_id = $1`, [dealId])) as { rows: { side: string; role: string; bid_id: string }[] };
    expect(row.rows[0]).toEqual({ side: 'BIDDER', role: 'BIDDER', bid_id: bids['Atlas Corp Dev'] });
    // The general invite form never invites bidders.
    expect((await call('seller', 'POST', '/invitations', { email: 'x@y.example', side: 'BIDDER', role: 'BIDDER' })).status).toBe(400);
    // Accept through the same security-definer function the invitation link uses.
    const token = 'a'.repeat(43);
    await db.owner.query(`UPDATE deal_invitations SET token_hash = $1 WHERE deal_id = $2`, [createHash('sha256').update(token).digest('hex'), dealId]);
    const userId = newId();
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name, email) VALUES ($1, $2, 'Atlas second', 'second.person@atlas.example')`, [userId, `auth0|atlas2-${userId.slice(-6)}`]);
    await db.owner.query(`SELECT * FROM app_accept_deal_invitation($1, $2)`, [createHash('sha256').update(token).digest('hex'), userId]);
    const member = (await db.owner.query(`SELECT role, bid_id FROM deal_memberships WHERE user_id = $1`, [userId])) as { rows: { role: string; bid_id: string }[] };
    expect(member.rows[0]).toEqual({ role: 'BIDDER', bid_id: bids['Atlas Corp Dev'] });
  });

  it('a bidder sees nothing but the NDA until they accept it', async () => {
    const before = await call('harbor', 'GET', '/my-bid');
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({
      process: { ndaText: expect.stringContaining('NDA'), sharedSummary: null, dataRoomUrl: null },
      bid: { firmName: 'Harbor Capital', status: 'INVITED', ndaAccepted: false },
    });
    expect((await call('harbor', 'GET', '/documents')).status).toBe(403);
    expect((await call('harbor', 'POST', '/my-bid/questions', { question: 'What is churn?' })).status).toBe(403);
    for (const firm of ['harbor', 'northline', 'atlas']) expect((await call(firm, 'POST', '/my-bid/nda')).status).toBe(200);
    const after = await call('harbor', 'GET', '/my-bid');
    expect(after.body).toMatchObject({ process: { sharedSummary: expect.stringContaining('Brightwave') }, bid: { status: 'ACTIVE', ndaAccepted: true } });
  });

  it('questions: private answers reach only the asker; answers to all never name who asked', async () => {
    const asked = await call('harbor', 'POST', '/my-bid/questions', { question: 'What is net revenue retention?' });
    const askedToo = await call('northline', 'POST', '/my-bid/questions', { question: 'Any change-of-control clauses?' });
    await call('seller', 'POST', `/bid-questions/${asked.body['id'] as string}/answer`, { answer: 'NRR is 112%.', scope: 'PRIVATE' });
    await call('seller', 'POST', `/bid-questions/${askedToo.body['id'] as string}/answer`, { answer: 'One customer contract has one.', scope: 'ALL' });

    const harbor = await call('harbor', 'GET', '/my-bid');
    expect(harbor.body['questions']).toEqual([expect.objectContaining({ question: 'What is net revenue retention?', answer: 'NRR is 112%.' })]);
    expect(harbor.body['published']).toEqual([expect.objectContaining({ question: 'Any change-of-control clauses?', answer: 'One customer contract has one.' })]);
    expect(JSON.stringify(harbor.body['published'])).not.toContain(bids['Northline Partners']);

    const atlas = await call('atlas', 'GET', '/my-bid');
    expect(atlas.body['questions']).toEqual([]);
    expect(JSON.stringify(atlas.body)).not.toContain('NRR is 112%');
    expect(JSON.stringify(atlas.body)).not.toContain('Harbor');
  });

  it('offers: each bidder sees only their own; revisions keep every version', async () => {
    const offer = (price: string) => ({ price, currency: 'USD', structure: 'Cash at close for 100% of shares', conditions: 'Subject to confirmatory diligence', validUntil: '2026-12-31' });
    expect((await call('harbor', 'POST', '/my-bid/offers', offer('52000000'))).body).toMatchObject({ version: 1 });
    expect((await call('harbor', 'POST', '/my-bid/offers', offer('54500000'))).body).toMatchObject({ version: 2 });
    expect((await call('northline', 'POST', '/my-bid/offers', offer('49000000'))).body).toMatchObject({ version: 1 });
    expect((await call('atlas', 'POST', '/my-bid/pass', { reason: 'Outside our sector focus this year.' })).body).toEqual({ status: 'PASSED' });

    const harbor = await call('harbor', 'GET', '/my-bid');
    expect((harbor.body['offers'] as Body[]).map((o) => o['price'])).toEqual(['52000000', '54500000']);
    expect(harbor.body['bid']).toMatchObject({ status: 'OFFERED' });
    const harborText = JSON.stringify(harbor.body);
    for (const leak of ['49000000', 'Northline', 'Atlas', 'sector focus', 'PASSED']) expect(harborText).not.toContain(leak);

    const board = await call('seller', 'GET', '/sale');
    const byFirm = Object.fromEntries((board.body['bids'] as { firmName: string; status: string; latestOffer: Body | null; passReason: string | null }[]).map((bid) => [bid.firmName, bid]));
    expect(byFirm['Harbor Capital']).toMatchObject({ status: 'OFFERED', latestOffer: { version: 2, price: '54500000' } });
    expect(byFirm['Northline Partners']).toMatchObject({ status: 'OFFERED', latestOffer: { version: 1, price: '49000000' } });
    expect(byFirm['Atlas Corp Dev']).toMatchObject({ status: 'PASSED', passReason: 'Outside our sector focus this year.' });
  });

  it('row-level security: a bidder reading the tables directly gets only their own rows', async () => {
    const harborBid = bids['Harbor Capital'] as string;
    const viaRls = async (who: string, sql: string) => {
      const member = (await db.owner.query(`SELECT u.id FROM users u WHERE u.display_name = $1`, [`${who} partner`])) as { rows: { id: string }[] };
      const userId = member.rows[0]?.id as string;
      return withTenantRows(db, { organizationId: seller.organizationId, userId, dealId }, sql);
    };
    expect(await viaRls('harbor', 'SELECT id FROM bids')).toEqual([{ id: harborBid }]);
    expect((await viaRls('harbor', 'SELECT bid_id FROM bid_offers')).every((row) => row['bid_id'] === harborBid)).toBe(true);
    expect((await viaRls('harbor', 'SELECT bid_id FROM bid_questions')).every((row) => row['bid_id'] === harborBid)).toBe(true);
    // Other bidders' people are invisible; the seller's team is not.
    const people = await viaRls('harbor', `SELECT role::text, bid_id FROM deal_memberships WHERE deal_id = '${dealId}'`);
    expect(people.filter((row) => row['role'] === 'BIDDER').every((row) => row['bid_id'] === harborBid)).toBe(true);
    expect(people.some((row) => row['role'] === 'DEAL_LEAD')).toBe(true);
    // A bidder cannot shortlist, decline or award themselves.
    await expect(viaRls('harbor', `UPDATE bids SET status = 'WON' WHERE id = '${harborBid}' RETURNING id`)).rejects.toThrow(/row-level security/);
    // Nor write another firm's offer.
    await expect(
      viaRls('harbor', `INSERT INTO bid_offers (id, organization_id, deal_id, bid_id, version, round, price, currency, structure, submitted_by) VALUES (gen_random_uuid(), '${seller.organizationId}', '${dealId}', '${bids['Northline Partners']}', 9, 1, 1, 'USD', 'spoof', gen_random_uuid()) RETURNING id`),
    ).rejects.toThrow(/row-level security/);
  });

  it('bidders never reach the seller’s side: the board, settings and documents not shared', async () => {
    expect((await call('harbor', 'GET', '/sale')).status).toBe(403);
    expect((await call('harbor', 'PUT', '/sale', { sharedSummary: 'x' })).status).toBe(403);
    expect((await call('harbor', 'POST', `/bids/${bids['Northline Partners']}/award`)).status).toBe(403);
    expect((await call('seller', 'GET', '/my-bid')).status).toBe(403);
    const confidential = await call('seller', 'POST', '/documents', { fileName: 'Seller valuation notes.txt', contentType: 'text/plain', contentBase64: Buffer.from('Our walk-away price is 45m.').toString('base64') });
    // Shared with every bidder at upload; the confidential note stays with the seller.
    await call('seller', 'POST', '/documents', { fileName: 'Teaser.txt', contentType: 'text/plain', contentBase64: Buffer.from('Brightwave teaser (synthetic).').toString('base64'), shared: true });
    const seen = (await call('harbor', 'GET', '/documents')).body['items'] as { fileName: string }[];
    expect(seen.map((document) => document.fileName)).toEqual(['Teaser.txt']);
    expect((await call('harbor', 'GET', `/documents/${confidential.body['id'] as string}`)).status).toBe(404);
  });

  it('shortlist and next round: only shortlisted bidders go on; the rest lose access', async () => {
    expect((await call('seller', 'POST', `/bids/${bids['Harbor Capital']}/shortlist`)).body).toMatchObject({ status: 'SHORTLISTED' });
    const round = await call('seller', 'POST', '/sale/next-round');
    expect(round.body).toEqual({ round: 2, continuing: 1, declined: 1 });
    // Their membership is revoked: the pact is gone for them.
    expect((await call('northline', 'GET', '/my-bid')).status).toBe(404);
    const harbor = await call('harbor', 'GET', '/my-bid');
    expect(harbor.body).toMatchObject({ process: { round: 2 }, bid: { status: 'ACTIVE', round: 2 } });
    // Earlier offers stay on record; a round-2 offer is a new version.
    expect((await call('harbor', 'POST', '/my-bid/offers', { price: '56000000', currency: 'USD', structure: 'Cash at close, binding' })).body).toMatchObject({ version: 3 });
  });

  it('award: the winner is marked, the process closes, and nobody else keeps access', async () => {
    expect((await call('seller', 'POST', `/bids/${bids['Northline Partners']}/award`)).status).toBe(422);
    expect((await call('seller', 'POST', `/bids/${bids['Harbor Capital']}/award`)).body).toEqual({ id: bids['Harbor Capital'], status: 'WON' });
    const board = await call('seller', 'GET', '/sale');
    expect(board.body['process']).toMatchObject({ status: 'AWARDED', awardedBidId: bids['Harbor Capital'] });
    expect((await call('harbor', 'GET', '/my-bid')).body).toMatchObject({ bid: { status: 'WON' }, process: { status: 'AWARDED' } });
    expect((await call('harbor', 'POST', '/my-bid/offers', { price: '1', currency: 'USD', structure: 'too late' })).status).toBe(409);
    const actions = (await db.owner.query(`SELECT action FROM audit_events WHERE deal_id = $1 AND action LIKE 'sale.%' ORDER BY chain_seq`, [dealId])) as { rows: { action: string }[] };
    expect(actions.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['sale.bid.added', 'sale.nda.accepted', 'sale.question.answered', 'sale.question.answered_all', 'sale.offer.submitted', 'sale.offer.revised', 'sale.bid.passed', 'sale.round.started', 'sale.awarded']),
    );
  });

  it('a buyer-led pact has no bid process', async () => {
    const buyerLed = await app.inject({ method: 'GET', url: `/v1/deals/${seller.dealId}/sale`, headers: { authorization: `Bearer ${tokens['seller'] ?? ''}` } });
    expect(buyerLed.statusCode).toBe(404);
  });
});

/** Run SQL as the app role for one user on one deal, so RLS applies exactly as in production. */
async function withTenantRows(db: TestDatabase, who: { organizationId: string; userId: string; dealId: string }, sql: string): Promise<Record<string, unknown>[]> {
  await db.owner.query('BEGIN');
  try {
    await db.owner.query(`SELECT set_config('app.organization_id', $1, true), set_config('app.user_id', $2, true), set_config('app.deal_ids', $3, true)`, [
      who.organizationId,
      who.userId,
      `{${who.dealId}}`,
    ]);
    await db.owner.query('SET LOCAL ROLE pactlab_app');
    const result = (await db.owner.query(sql)) as { rows: Record<string, unknown>[] };
    await db.owner.query('COMMIT');
    return result.rows;
  } catch (error) {
    await db.owner.query('ROLLBACK');
    throw error;
  }
}
