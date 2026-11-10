import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comparableTemplateCsv, csvCell } from '@pactlab/contracts';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

const PACT = {
  name: 'Project Harbor',
  baseCurrency: 'USD',
  buyer: { name: 'Alpha Capital', ownership: 'PRIVATE' },
  seller: { name: 'Harbor Software', ownership: 'PRIVATE', companyType: 'SOFTWARE_SAAS' },
  askingPrice: { amount: '5,000,000', currency: 'USD', basis: 'ENTERPRISE_VALUE', source: 'LETTER_OF_INTENT' },
};
const VALUES = {
  assumptions: { method: 'ARR_MULTIPLE', arr: '1000000', multiple: '4' },
  bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
};

describe('batch-loading comparables (T-111)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let signingKey: CryptoKey;
  const tokens: Record<string, string> = {};

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey);

  async function call(who: string, method: 'GET' | 'POST', url: string, payload?: unknown) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload: payload as Body } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }
  const audits = async (action: string) =>
    ((await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = $1 AND outcome = 'SUCCEEDED'`, [action])) as { rows: { n: number }[] }).rows[0]?.n;

  let dealId: string;

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
    });
    tokens['lead'] = await token(a.subject, a);
    tokens['other'] = await token(b.subject, b);
    const started = await call('lead', 'POST', '/v1/pacts', PACT);
    dealId = started.body['id'] as string;
    const onPact = { ...a, dealId };
    for (const role of ['ANALYST', 'REVIEWER', 'TARGET_CONTRIBUTOR'] as const) {
      tokens[role.toLowerCase()] = await token((await addSyntheticDealMember(db.owner, onPact, role)).subject, a);
    }
    const created = await call('lead', 'POST', `/v1/deals/${dealId}/valuation/scenarios`, { name: 'Base case', values: VALUES });
    const scenarioId = (created.body['scenario'] as Body)['id'] as string;
    expect((await call('lead', 'POST', `/v1/deals/${dealId}/valuation/scenarios/${scenarioId}/runs`, { expectedVersion: 1 })).status).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });


  const HEADER = 'Kind,Name,Target,Acquirer,Date,Company type,Region,EV,ARR,Basis,Currency,ARR growth %,NRR %,GRR %,Source,Source URL';
  const row = (n: number, overrides: Partial<Record<'kind' | 'ev' | 'type' | 'source' | 'date', string>> = {}) =>
    [
      overrides.kind ?? 'Precedent transaction',
      `Batch precedent ${n}`,
      `Batch Target ${n}`,
      'Synthetic Acquirer',
      overrides.date ?? '2025-05-01',
      overrides.type ?? 'Software / SaaS',
      'North America',
      overrides.ev ?? `"${(4_000_000 + n * 10_000).toLocaleString('en-US')}"`,
      '1000000',
      'ARR',
      'USD',
      '20',
      '105',
      '90',
      overrides.source ?? `Synthetic press release ${n}`,
      '',
    ].join(',');
  const file = (rows: string[]) => [HEADER, ...rows].join('\r\n');
  const preview = (who: string, text: string) => call(who, 'POST', '/v1/comparables/batch/preview', { text });
  const benchmarkCount = async () => (await call('lead', 'GET', `/v1/deals/${dealId}/benchmark`)).body['count'] as number;

  it('previews a 50-row template file as all OK, imports 50 in one go, and the benchmark uses them', async () => {
    expect(comparableTemplateCsv().split('\r\n')[0]).toBe(HEADER);
    const text = file(Array.from({ length: 50 }, (_, n) => row(n + 1)));
    const checked = await preview('lead', text);
    expect(checked.status).toBe(200);
    expect(checked.body['counts']).toEqual({ total: 50, ok: 50, problems: 0, duplicates: 0 });
    expect(await audits('comparable.recorded')).toBe(0);
    const before = await benchmarkCount();
    const imported = await call('lead', 'POST', '/v1/comparables/batch', { text });
    expect(imported.status).toBe(201);
    expect(imported.body['imported']).toBe(50);
    expect(await benchmarkCount()).toBe(before + 50);
    expect(await audits('comparable.recorded')).toBe(50);
    expect(await audits('comparables.batch_imported')).toBe(1);
    // One import's comparables share the batch event's request id, so the log counts them.
    const counted = await db.owner.query(
      `SELECT count(*)::int AS n FROM audit_events r JOIN audit_events b ON b.request_id = r.request_id AND b.action = 'comparables.batch_imported' WHERE r.action = 'comparable.recorded'`,
    );
    expect((counted.rows[0] as { n: number }).n).toBe(50);
  });

  it('shows bad rows with reasons, imports the rest, and the problem rows round-trip', async () => {
    const text = file([
      row(101),
      row(102, { source: '' }),
      row(103, { ev: '-5000000' }),
      row(104, { type: 'Spaceships' }),
      row(105),
    ]);
    const checked = await preview('lead', text);
    expect(checked.body['counts']).toEqual({ total: 5, ok: 2, problems: 3, duplicates: 0 });
    const rows = checked.body['rows'] as { line: number; status: string; problems: { column: string; message: string }[]; cells: Record<string, string> }[];
    const problems = rows.filter((item) => item.status === 'PROBLEM');
    expect(problems.map((item) => [item.line, item.problems[0]?.column])).toEqual([
      [3, 'Source'],
      [4, 'EV'],
      [5, 'Company type'],
    ]);
    expect(problems[2]?.problems[0]?.message).toMatch(/Unknown company type/);
    const imported = await call('lead', 'POST', '/v1/comparables/batch', { text });
    expect(imported.body['imported']).toBe(2);
    // The problem rows as a CSV (as the page builds it) keep the file's cells; fixed, they import cleanly.
    const csv = (cells: Record<string, string>[]) => [HEADER, ...cells.map((item) => Object.values(item).map(csvCell).join(','))].join('\r\n');
    expect(csv(problems.map((item) => item.cells)).split('\r\n')[2]).toContain('-5000000');
    const fixed = problems.map((item) => ({ ...item.cells, Source: item.cells['Source'] || 'Synthetic filing', EV: item.cells['EV']?.replace('-', '') ?? '', 'Company type': 'Fintech' }));
    const again = await call('lead', 'POST', '/v1/comparables/batch', { text: csv(fixed) });
    expect(again.body['counts']).toMatchObject({ total: 3, ok: 3, problems: 0 });
    expect(again.body['imported']).toBe(3);
  });

  it('reads tab-separated rows pasted from a spreadsheet the same as a file', async () => {
    const tsv = [HEADER, row(201), row(202)].map((line) => line.replace(/"[^"]*"|,/g, (m) => (m === ',' ? '\t' : m.slice(1, -1)))).join('\n');
    const checked = await preview('lead', tsv);
    expect(checked.body['counts']).toEqual({ total: 2, ok: 2, problems: 0, duplicates: 0 });
    expect((await call('lead', 'POST', '/v1/comparables/batch', { text: tsv })).body['imported']).toBe(2);
  });

  it('flags duplicates and skips them unless kept explicitly', async () => {
    const text = file([row(1), row(301), row(301)]);
    const checked = await preview('lead', text);
    const rows = checked.body['rows'] as { line: number; status: string; duplicateOf: string | null }[];
    expect(rows.map((item) => [item.status, item.duplicateOf])).toEqual([
      ['DUPLICATE', 'EXISTING'],
      ['OK', null],
      ['DUPLICATE', 'BATCH'],
    ]);
    expect((await call('lead', 'POST', '/v1/comparables/batch', { text })).body['imported']).toBe(1);
    const kept = await call('lead', 'POST', '/v1/comparables/batch', { text: file([row(2)]), keepDuplicates: [2] });
    expect(kept.body['imported']).toBe(1);
    expect((await call('lead', 'POST', '/v1/comparables/batch', { text: file([row(3)]) })).status).toBe(422);
  });

  it('is refused to non-writers, capped at 500 rows, and invisible to another organization', async () => {
    const text = file([row(401)]);
    expect((await preview('analyst', text)).status).toBe(403);
    expect((await call('analyst', 'POST', '/v1/comparables/batch', { text })).status).toBe(403);
    const tooMany = await preview('lead', file(Array.from({ length: 501 }, (_, n) => row(1000 + n))));
    expect(tooMany.status).toBe(422);
    expect(tooMany.body['code']).toBe('BATCH_TOO_LARGE');
    expect(((await call('other', 'GET', '/v1/comparables')).body['items'] as Body[]).length).toBe(0);
    // Bravo's own check sees none of Alpha's rows as duplicates.
    expect((await preview('other', file([row(1)]))).body['counts']).toMatchObject({ ok: 1, duplicates: 0 });
  });
});
