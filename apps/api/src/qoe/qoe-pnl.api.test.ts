import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { QOE_PNL_CONFLICT_EVIDENCE_TYPE, qoeDirectionFor } from '@pactlab/domain';
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

const MONTHS = Array.from({ length: 12 }, (_, index) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][index]} 2025`);
/** A synthetic FY2025 P&L, months across: EBITDA 50,000 a month, 600,000 for the year. */
const PNL = [
  `Line,${MONTHS.join(',')}`,
  `Subscription revenue,${MONTHS.map(() => '100000').join(',')}`,
  `Hosting,${MONTHS.map(() => '20000').join(',')}`,
  `Salaries and wages,${MONTHS.map(() => '30000').join(',')}`,
].join('\n');
const FILED = ['Income statement FY2025 (synthetic, as filed)', 'EBITDA as reported: 650,000', 'EBITDA as restated: 600,000'].join('\n');

/** T-149: quality of earnings and valuation read the imported P&L; a disagreement with a filed statement is a finding. */
describe('the imported P&L in quality of earnings and valuation', { timeout: 180_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;
  const tokens: Record<string, string> = {};
  let filedDoc = '';

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(signingKey);
  async function call(who: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload: payload as Body } : {}) });
    return { status: response.statusCode, body: (response.headers['content-type']?.includes('json') ? response.json() : {}) as Body };
  }
  const qoe = (path = '') => `/v1/deals/${a.dealId}/qoe${path}`;
  type Period = { period: string; reportedEbitda: { amount: string; source: string } | null; adjustedEbitda: string | null; conflict: Body | null; pnl: { revenue: string; ebitda: string; sources: { evidenceId: string }[]; rolledUpFrom: string[] | null } | null; pnlFiles: { fileName: string }[] };
  type View = { engineVersion: string; schedule: Period[]; conflicts: { period: string; findingId: string | null; difference: string }[]; importedPnl: { periods: number; files: { fileName: string }[] }; entries: { entryKey: string; version: number; kind: string }[] };

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
      foresightAutoBaseline: false,
      documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner() },
      uploads: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner() },
    });
    tokens['lead'] = await token(a.subject, a);
    tokens['other'] = await token(b.subject, b);
    for (const role of ['ANALYST', 'REVIEWER', 'TARGET_CONTRIBUTOR'] as const) tokens[role.toLowerCase()] = await token((await addSyntheticDealMember(db.owner, a, role)).subject, a);

    filedDoc = (await call('lead', 'POST', `/v1/deals/${a.dealId}/documents`, { fileName: 'income-statement-fy2025.txt', contentType: 'text/plain', contentBase64: Buffer.from(FILED).toString('base64'), dataClass: 'FINANCIAL' })).body['id'] as string;

    // The P&L import (ADR 0038): names matched, months read from the header, line kinds confirmed by a person.
    const uploaded = await app.inject({
      method: 'POST',
      url: `/v1/deals/${a.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=pnl-fy2025.csv`,
      headers: { authorization: `Bearer ${tokens['lead']}`, 'content-type': 'text/csv' },
      payload: PNL,
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const upload = uploaded.json() as Body;
    const mapping = { ...(upload['suggestedMapping'] as Body), lineKinds: { 'Subscription revenue': 'REVENUE', Hosting: 'COGS', 'Salaries and wages': 'OPEX' } };
    const imported = await call('lead', 'POST', `/v1/deals/${a.dealId}/uploads/${upload['id'] as string}/import`, { mapping });
    expect(imported.body, JSON.stringify(imported.body)).toMatchObject({ syncRun: { status: 'SUCCEEDED', recordsCreated: 36 } });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('reads reported revenue, costs and EBITDA per month from the imported lines, each citing its source rows', async () => {
    const view = (await call('analyst', 'GET', qoe())).body as unknown as View;
    expect(view.engineVersion).toBe('qoe-2');
    expect(view.importedPnl).toMatchObject({ periods: 12, files: [{ fileName: 'pnl-fy2025.csv' }] });
    expect(view.schedule.map((period) => period.period)).toEqual(MONTHS.map((_, index) => `2025-${String(index + 1).padStart(2, '0')}`));
    const [january] = view.schedule;
    expect(january).toMatchObject({ reportedEbitda: { amount: '50000.00', source: 'IMPORTED_PNL' }, adjustedEbitda: '50000.00', conflict: null, pnl: { revenue: '100000.00', ebitda: '50000.00' }, pnlFiles: [{ fileName: 'pnl-fy2025.csv' }] });
    const ids = january!.pnl!.sources.map((row) => row.evidenceId);
    const stored = await db.owner.query(`SELECT count(*)::int AS n FROM evidence_items WHERE deal_id = $1 AND evidence_type = 'finance.pnl_line' AND id = ANY ($2::uuid[])`, [a.dealId, ids]);
    expect(stored.rows[0]).toEqual({ n: 3 });
  });

  it('gives valuation trailing revenue and EBITDA from the P&L, with its source, to the buyer side only', async () => {
    const basis = await call('analyst', 'GET', `/v1/deals/${a.dealId}/valuation/pnl-basis`);
    expect(basis.status).toBe(200);
    expect(basis.body).toMatchObject({ currency: 'USD', imported: true, unavailable: null, readerVersion: 'pnl-1', trailing: { basis: 'TTM', from: '2025-01', to: '2025-12', revenue: '1200000.00', ebitda: '600000.00', lineCount: 36, files: [{ fileName: 'pnl-fy2025.csv' }] } });
    expect((await call('target_contributor', 'GET', `/v1/deals/${a.dealId}/valuation/pnl-basis`)).status).toBe(403);
    expect((await call('other', 'GET', `/v1/deals/${a.dealId}/valuation/pnl-basis`)).status).toBe(404);
    expect((await call('target_contributor', 'GET', qoe())).status).toBe(403);
  });

  it('a filed statement that disagrees is a cited finding to review, and adjusted EBITDA waits; it never picks silently', async () => {
    const recorded = await call('analyst', 'POST', qoe('/entries'), { kind: 'REPORTED_EBITDA', period: 'FY2025', label: 'EBITDA as filed', amount: '650,000', currency: 'USD', citation: { documentId: filedDoc, pageNumber: 1, quote: 'EBITDA as reported: 650,000' } });
    expect(recorded.status).toBe(201);
    const view = recorded.body as unknown as View;
    const year = view.schedule.find((period) => period.period === 'FY2025')!;
    expect(year).toMatchObject({ reportedEbitda: null, adjustedEbitda: null, conflict: { imported: '600000.00', filed: '650000.00', difference: '-50000.00' } });
    expect(year.pnl!.rolledUpFrom).toHaveLength(12);
    expect(view.conflicts).toHaveLength(1);
    const findingId = view.conflicts[0]!.findingId;
    expect(findingId).toBeTruthy();

    const finding = (await db.owner.query(`SELECT status, direction, priced_risk_low, fingerprint FROM findings WHERE id = $1`, [findingId])).rows[0] as Body;
    expect(finding).toMatchObject({ status: 'DRAFT', direction: qoeDirectionFor(QOE_PNL_CONFLICT_EVIDENCE_TYPE, 'disagrees').defaultDirection, priced_risk_low: null });
    expect(String(finding['fingerprint'])).toMatch(/^qoe:pnl-conflict:/);
    const links = (await db.owner.query(`SELECT count(*) FILTER (WHERE document_citation IS NOT NULL)::int AS pages, count(*) FILTER (WHERE evidence_item_id IS NOT NULL)::int AS rows FROM finding_evidence_links WHERE finding_id = $1`, [findingId])).rows[0];
    // Both sides cited: the filed page, and the imported rows (36 make up the year; the first 25 are linked).
    expect(links).toEqual({ pages: 1, rows: 25 });

    // Raising again changes nothing; only the buyer's writers may raise.
    expect((await call('lead', 'POST', qoe('/pnl-conflicts'))).body).toEqual({ created: 0, existing: 1 });
    expect((await call('reviewer', 'POST', qoe('/pnl-conflicts'))).status).toBe(403);
    expect((await call('other', 'POST', `/v1/deals/${a.dealId}/qoe/pnl-conflicts`)).status).toBe(404);
  });

  it('once corrected, the two agree and the schedule computes from the imported figure', async () => {
    const before = (await call('analyst', 'GET', qoe())).body as unknown as View;
    const entry = before.entries.find((candidate) => candidate.kind === 'REPORTED_EBITDA')!;
    const revised = await call('analyst', 'PUT', qoe(`/entries/${entry.entryKey}`), {
      expectedVersion: entry.version,
      reason: 'The restated figure',
      entry: { kind: 'REPORTED_EBITDA', period: 'FY2025', label: 'EBITDA as restated', amount: '600,000', currency: 'USD', citation: { documentId: filedDoc, pageNumber: 1, quote: 'EBITDA as restated: 600,000' } },
    });
    expect(revised.status).toBe(200);
    const view = revised.body as unknown as View;
    expect(view.conflicts).toEqual([]);
    expect(view.schedule.find((period) => period.period === 'FY2025')).toMatchObject({ reportedEbitda: { amount: '600000.00', source: 'BOTH' }, adjustedEbitda: '600000.00', conflict: null });
  });
});
