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

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

const BALANCE_SHEET = [
  'Balance sheet at 30 September 2026 (synthetic)',
  'Cash and cash equivalents: 90,000',
  'Term loan outstanding: 120,000',
  'Deferred revenue: 22,000',
  'Accrued bonuses: 13,000',
].join('\n');

describe('balance-sheet items through the API', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;
  const tokens: Record<string, string> = {};
  let documentId: string;
  let hrDocumentId: string;

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey);

  async function call(who: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload: payload as Body } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const items = (path = '') => `/v1/deals/${a.dealId}/balance-sheet-items${path}`;
  const scenarios = (path = '') => `/v1/deals/${a.dealId}/valuation/scenarios${path}`;
  const upload = async (fileName: string, text: string, dataClass: string) =>
    (await call('lead', 'POST', `/v1/deals/${a.dealId}/documents`, { fileName, contentType: 'text/plain', contentBase64: Buffer.from(text).toString('base64'), dataClass })).body['id'] as string;
  const item = (overrides: Body = {}) => ({
    kind: 'DEBT',
    category: 'TERM_LOAN',
    label: 'Term loan',
    amount: '120,000',
    currency: 'USD',
    asOf: '2026-09-30',
    documentId,
    pageNumber: 1,
    quote: 'Term loan outstanding: 120,000',
    ...overrides,
  });
  const audits = async (action: string) =>
    ((await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = $1 AND outcome = 'SUCCEEDED'`, [action])) as { rows: { n: number }[] }).rows[0]?.n;

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner() },
    });
    tokens['lead'] = await token(a.subject, a);
    tokens['other'] = await token(b.subject, b);
    for (const role of ['ANALYST', 'REVIEWER', 'TARGET_CONTRIBUTOR'] as const) {
      tokens[role.toLowerCase()] = await token((await addSyntheticDealMember(db.owner, a, role)).subject, a);
    }
    documentId = await upload('balance-sheet.txt', BALANCE_SHEET, 'FINANCIAL');
    hrDocumentId = await upload('bonus-plan.txt', 'Accrued bonuses: 13,000 for named staff (synthetic)', 'HR');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('records items only with a quote that is really on the page', async () => {
    expect(documentId).toBeTruthy();
    expect((await call('analyst', 'POST', items(), item({ quote: 'Term loan outstanding: 999,000' }))).status).toBe(422);
    expect((await call('analyst', 'POST', items(), item({ pageNumber: 2 }))).status).toBe(422);
    expect((await call('analyst', 'POST', items(), item({ documentId: hrDocumentId, kind: 'DEBT_LIKE', category: 'ACCRUED_BONUS', quote: 'Accrued bonuses: 13,000 for named staff' }))).status).toBe(422);
    expect((await call('analyst', 'POST', items(), item({ category: 'DEFERRED_REVENUE' }))).status).toBe(400);
    expect((await call('reviewer', 'POST', items(), item())).status).toBe(403);
    expect((await call('target_contributor', 'GET', items())).status).toBe(403);
    expect((await call('other', 'GET', items())).status).toBe(404);

    const created = await call('analyst', 'POST', items(), item());
    expect(created.status).toBe(201);
    await call('analyst', 'POST', items(), item({ kind: 'CASH', category: 'CASH', label: 'Cash', amount: '90000', quote: 'Cash and cash equivalents: 90,000' }));
    await call('analyst', 'POST', items(), item({ kind: 'DEBT_LIKE', category: 'DEFERRED_REVENUE', label: 'Deferred revenue', amount: '22000', quote: 'Deferred revenue: 22,000' }));
    const view = await call('reviewer', 'GET', items());
    expect(view.body).toMatchObject({ canEdit: false, totals: { currency: 'USD', cash: '90000.00', debt: '120000.00', debtLike: '22000.00' } });
    expect((view.body['items'] as Body[])[0]).toMatchObject({
      amount: '120000',
      version: 1,
      citationValid: true,
      citation: { documentName: 'balance-sheet.txt', pageNumber: 1, quote: 'Term loan outstanding: 120,000' },
      history: [{ version: 1, reason: 'Recorded' }],
    });
    expect((view.body['documents'] as Body[]).map((doc) => doc['fileName'])).toEqual(['balance-sheet.txt']);
    expect(await audits('balance_sheet_item.created')).toBe(3);
  });

  it('itemises the bridge, and goes stale when a linked item is revised or withdrawn', async () => {
    const list = (await call('lead', 'GET', items())).body['items'] as Body[];
    const ids = list.map((entry) => entry['id'] as string);
    const loan = list.find((entry) => entry['category'] === 'TERM_LOAN')!;
    const values = {
      assumptions: { method: 'ARR_MULTIPLE', arr: '268000', multiple: '4' },
      bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '-20000' },
      balanceSheetLinks: ids,
    };
    const created = await call('lead', 'POST', scenarios(), { name: 'Itemised', values });
    expect(created.status).toBe(201);
    const id = (created.body['scenario'] as Body)['id'] as string;
    const ran = await call('lead', 'POST', scenarios(`/${id}/runs`), { expectedVersion: 1 });
    const result = (ran.body['latestRun'] as { result: { engineVersion: string; bridge: { equityValue: { amount: string }; lines: Body[] } } }).result;
    expect(result.engineVersion).toBe('valuation-2');
    // 1,072,000 + 90,000 − 120,000 − 22,000 − 20,000
    expect(result.bridge.equityValue.amount).toBe('1000000.00');
    expect(result.bridge.lines.filter((line) => line['balanceSheetItemId']).map((line) => line['kind'])).toEqual(['CASH_ITEM', 'DEBT_ITEM', 'DEBT_LIKE_ITEM']);

    const revised = await call('analyst', 'PUT', items(`/${loan['id'] as string}`), { ...item({ amount: '125000' }), kind: undefined, expectedVersion: 1, reason: 'Accrued interest added' });
    expect(revised.status).toBe(200);
    expect((await call('analyst', 'PUT', items(`/${loan['id'] as string}`), { ...item(), kind: undefined, expectedVersion: 1, reason: 'Stale edit' })).status).toBe(409);
    const stale = (await call('lead', 'GET', scenarios(`/${id}`))).body;
    expect(stale['staleReasons']).toEqual([{ kind: 'BALANCE_SHEET_ITEM_CHANGED', itemId: loan['id'] }]);

    const rerun = await call('lead', 'POST', scenarios(`/${id}/runs`), { expectedVersion: 2 });
    expect(rerun.body['stale']).toBe(false);
    expect((rerun.body['latestRun'] as { result: { bridge: { equityValue: { amount: string } } } }).result.bridge.equityValue.amount).toBe('995000.00');

    const withdrawn = await call('analyst', 'POST', items(`/${loan['id'] as string}/withdraw`), { expectedVersion: 2, reason: 'Repaid before signing' });
    expect(withdrawn.status).toBe(200);
    expect((await call('lead', 'GET', scenarios(`/${id}`))).body['staleReasons']).toEqual([{ kind: 'BALANCE_SHEET_ITEM_MISSING', itemId: loan['id'] }]);
    // A withdrawn item cannot be linked to a new run.
    expect((await call('lead', 'POST', scenarios(`/${id}/runs`), { expectedVersion: 3 })).status).toBe(422);
    expect(await audits('balance_sheet_item.revised')).toBe(1);
    expect(await audits('balance_sheet_item.withdrawn')).toBe(1);
  });
});
