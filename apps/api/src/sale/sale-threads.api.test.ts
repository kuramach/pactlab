import 'reflect-metadata';
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
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
type Body = Record<string, unknown>;
const b64 = (text: string) => Buffer.from(text).toString('base64');

/** T-097: bidders comment on shared documents and attach files to their bid — seen by the seller and their own firm only. */
describe('bid comments and files', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let seller: SyntheticTenant;
  let key: CryptoKey;
  const store = new InMemoryObjectStore();
  const tokens: Record<string, string> = {};
  const bids: Record<string, string> = {};
  let shared = '';
  let confidential = '';
  let harborComment = '';
  let harborFile = '';

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string, method: 'GET' | 'POST', path: string, payload?: Body) {
    const response = await app.inject({ method, url: `/v1/deals/${seller.dealId}${path}`, headers: { authorization: `Bearer ${tokens[who] ?? ''}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.headers['content-type'] ?? '').includes('json') ? (response.json() as Body) : {}, raw: response.body };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    seller = await createSyntheticTenant(db.owner, 'Seller');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      documents: { objectStore: store, malwareScanner: new SignatureMalwareScanner() },
    });
    tokens['seller'] = await token(seller.subject, seller.auth0OrganizationId);
    await db.owner.query(`UPDATE deals SET initiated_by = 'SELLER' WHERE id = $1`, [seller.dealId]);
    await db.owner.query(`INSERT INTO sale_processes (organization_id, deal_id, updated_by) VALUES ($1, $2, $3)`, [seller.organizationId, seller.dealId, seller.userId]);
    for (const firm of ['harbor', 'northline']) {
      bids[firm] = newId();
      await db.owner.query(`INSERT INTO bids (id, organization_id, deal_id, firm_name, status, created_by) VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`, [bids[firm], seller.organizationId, seller.dealId, `${firm} (synthetic)`, seller.userId]);
      const userId = newId();
      const subject = `auth0|${firm}-${userId.slice(-6)}`;
      await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name) VALUES ($1, $2, $3)`, [userId, subject, `${firm} partner`]);
      await db.owner.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'MEMBER')`, [newId(), seller.organizationId, userId]);
      await db.owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role, bid_id) VALUES ($1, $2, $3, $4, 'BIDDER', $5)`, [newId(), seller.organizationId, seller.dealId, userId, bids[firm]]);
      tokens[firm] = await token(subject, seller.auth0OrganizationId);
    }
    const upload = async (fileName: string, sharedWithBidders: boolean) =>
      (await call('seller', 'POST', '/documents', { fileName, contentType: 'text/plain', contentBase64: b64(`${fileName}: 14. Change of control. Customer may terminate on a change of control.`), shared: sharedWithBidders })).body['id'] as string;
    shared = await upload('Draft SPA.txt', true);
    confidential = await upload('Walk-away price.txt', false);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('a bidder comments on a shared document, pinned to a page and a passage', async () => {
    const posted = await call('harbor', 'POST', '/my-bid/comments', { documentId: shared, pageNumber: 1, quote: '14. Change of control.', body: 'We would need clause 14 removed.' });
    expect(posted.status).toBe(201);
    harborComment = posted.body['id'] as string;
    // Never on a document the seller kept to itself.
    expect((await call('harbor', 'POST', '/my-bid/comments', { documentId: confidential, body: 'x' })).status).toBe(404);
  });

  it('a bidder attaches a file to their bid; infected files are refused', async () => {
    const attached = await call('harbor', 'POST', '/my-bid/files', { fileName: 'SPA markup.txt', contentType: 'text/plain', contentBase64: b64('Clause 14: delete.') });
    expect(attached.status).toBe(201);
    harborFile = attached.body['id'] as string;
    expect([...store.objects.keys()].some((key) => key.includes(`/bids/${bids['harbor']}/`))).toBe(true);
    expect((await call('harbor', 'POST', '/my-bid/files', { fileName: 'bad.txt', contentType: 'text/plain', contentBase64: b64(EICAR) })).status).toBe(422);
    // It never enters the shared library.
    const library = (await call('northline', 'GET', '/documents')).body['items'] as { fileName: string }[];
    expect(library.map((document) => document.fileName)).toEqual(['Draft SPA.txt']);
  });

  it('the seller sees every bid’s comments and files, and replies privately', async () => {
    const board = await call('seller', 'GET', '/sale');
    const harbor = (board.body['bids'] as { id: string; comments: Body[]; files: Body[] }[]).find((bid) => bid.id === bids['harbor']);
    expect(harbor?.comments).toEqual([expect.objectContaining({ documentName: 'Draft SPA.txt', pageNumber: 1, quote: '14. Change of control.', body: 'We would need clause 14 removed.', authorSide: 'BIDDER', replies: [] })]);
    expect(harbor?.files).toEqual([expect.objectContaining({ fileName: 'SPA markup.txt' })]);
    expect((await call('seller', 'POST', `/bid-comments/${harborComment}/replies`, { body: 'We can cap the clause at 12 months.' })).status).toBe(201);
    const download = await call('seller', 'GET', `/bid-files/${harborFile}`);
    expect(download.status).toBe(200);
    expect(download.raw).toBe('Clause 14: delete.');
  });

  it('the bidder sees the reply; no other bidder sees any of it', async () => {
    const harbor = await call('harbor', 'GET', '/my-bid');
    expect(harbor.body['comments']).toEqual([expect.objectContaining({ body: 'We would need clause 14 removed.', replies: [expect.objectContaining({ authorSide: 'SELLER', body: 'We can cap the clause at 12 months.' })] })]);
    const northline = await call('northline', 'GET', '/my-bid');
    expect(northline.body['comments']).toEqual([]);
    expect(northline.body['files']).toEqual([]);
    expect(JSON.stringify(northline.body)).not.toContain('clause 14');
    expect((await call('northline', 'GET', `/bid-files/${harborFile}`)).status).toBe(404);
    // Nor can they reply in Harbor's thread.
    expect((await call('northline', 'POST', '/my-bid/comments', { documentId: shared, parentId: harborComment, body: 'me too' })).status).toBe(404);
    expect((await call('harbor', 'POST', `/bid-comments/${harborComment}/replies`, { body: 'x' })).status).toBe(403);
  });

  it('row-level security: direct reads as another bidder return nothing, and writes are refused', async () => {
    const northlineUser = ((await db.owner.query(`SELECT id FROM users WHERE display_name = 'northline partner'`)) as { rows: { id: string }[] }).rows[0]?.id as string;
    await db.owner.query('BEGIN');
    try {
      await db.owner.query(`SELECT set_config('app.organization_id', $1, true), set_config('app.user_id', $2, true), set_config('app.deal_ids', $3, true)`, [seller.organizationId, northlineUser, `{${seller.dealId}}`]);
      await db.owner.query('SET LOCAL ROLE pactlab_app');
      expect(((await db.owner.query('SELECT id FROM bid_comments')) as { rows: unknown[] }).rows).toEqual([]);
      expect(((await db.owner.query('SELECT id FROM bid_files')) as { rows: unknown[] }).rows).toEqual([]);
      await expect(
        db.owner.query(`INSERT INTO bid_comments (id, organization_id, deal_id, bid_id, document_id, body, author_side, author_id) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'spoof', 'BIDDER', $5)`, [seller.organizationId, seller.dealId, bids['harbor'], shared, northlineUser]),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await db.owner.query('ROLLBACK');
    }
  });
});
