import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
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

const LINE_KINDS = { Revenue: 'REVENUE', Hosting: 'COGS', Salaries: 'OPEX' };

/** T-170: an import is read in the pact's currency; a mismatch is asked, a mixed statement set refused, nothing converted. */
describe('import currency', { timeout: 120_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let pact: SyntheticTenant;
  let signingKey: CryptoKey;
  let bearer = '';

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(signingKey);
  async function call(method: 'POST', url: string, payload: unknown) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, payload: payload as Body });
    return { status: response.statusCode, body: (response.headers['content-type']?.includes('json') ? response.json() : {}) as Body };
  }
  async function upload(fileName: string, csv: string): Promise<{ id: string; mapping: Body }> {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/deals/${pact.dealId}/uploads?target=FINANCIAL_PNL&system=pactlab_standard&fileName=${fileName}`,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'text/csv' },
      payload: csv,
    });
    expect(response.statusCode, response.body).toBe(201);
    const body = response.json() as Body;
    const amount = csv.split('\n')[0]!.split(',')[2]!;
    return {
      id: body['id'] as string,
      mapping: {
        target: 'FINANCIAL_PNL',
        fields: { account: { kind: 'column', column: 'line' }, month: { kind: 'column', column: 'year' }, amount: { kind: 'column', column: amount } },
        dateFormat: 'YYYY-MM-DD',
        numberFormat: 'DOT_DECIMAL',
        amountUnit: 'MAJOR',
        negateAmounts: false,
        lineKinds: LINE_KINDS,
      },
    };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    pact = await createSyntheticTenant(db.owner, 'Yen');
    await db.owner.query(`UPDATE deals SET base_currency = 'JPY' WHERE id = $1`, [pact.dealId]);
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' }] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      foresightAutoBaseline: false,
      documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner() },
      uploads: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner() },
    });
    bearer = await token(pact.subject, pact);
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('flags a file in another currency than the pact’s, asks the reviewer, and refuses to import it', async () => {
    const { id, mapping } = await upload('pnl-eur.csv', ['line,year,amount (EUR)', 'Revenue,2024,1000000', 'Hosting,2024,200000', 'Salaries,2024,300000'].join('\n'));
    const preview = await call('POST', `/v1/deals/${pact.dealId}/uploads/${id}/preview`, { mapping });
    expect(preview.status).toBe(200);
    expect(preview.body['currency']).toEqual({ pact: 'JPY', declared: null, detected: ['EUR'], readAs: 'JPY', question: 'This file shows EUR; the pact is in JPY. What currency are these amounts in?' });
    expect(preview.body['problems']).toContain(
      'This file shows amounts in EUR, but this pact is in JPY. Pactlab never converts amounts: import the figures in JPY, or say the file is in JPY if the label is wrong.',
    );
    expect((await call('POST', `/v1/deals/${pact.dealId}/uploads/${id}/import`, { mapping })).status).toBe(422);
    // Declaring another currency than the pact's is refused too; nothing converts.
    const declared = await call('POST', `/v1/deals/${pact.dealId}/uploads/${id}/preview`, { mapping: { ...mapping, currency: 'EUR' } });
    expect((declared.body['problems'] as string[])[0]).toMatch(/^You said these amounts are in EUR, but this pact is in JPY/);
  });

  it('refuses a statement set that mixes currencies, with a clear message', async () => {
    const { id, mapping } = await upload('pnl-mixed.csv', ['line,year,amount', 'Revenue,2024,£1000000', 'Revenue,2025,€1200000', 'Hosting,2024,200000'].join('\n'));
    const preview = await call('POST', `/v1/deals/${pact.dealId}/uploads/${id}/preview`, { mapping: { ...mapping, currency: 'JPY' } });
    expect(preview.body['problems']).toContain(
      "This file mixes amounts in GBP and EUR. One statement must be in one currency, and Pactlab never converts: import each currency's figures as its own file, in JPY.",
    );
    expect((await call('POST', `/v1/deals/${pact.dealId}/uploads/${id}/import`, { mapping: { ...mapping, currency: 'JPY' } })).status).toBe(422);
  });

  it('imports a statement in the pact’s currency, whole yen, stamped with the currency it was declared in', async () => {
    const { id, mapping } = await upload('pnl-jpy.csv', ['line,year,amount (JPY)', 'Revenue,2024,150000000', 'Hosting,2024,30000000', 'Salaries,2024,45000000', 'Revenue,2025,180000000', 'Hosting,2025,36000000', 'Salaries,2025,49500000'].join('\n'));
    const preview = await call('POST', `/v1/deals/${pact.dealId}/uploads/${id}/preview`, { mapping: { ...mapping, currency: 'JPY' } });
    expect(preview.body['problems']).toEqual([]);
    expect(preview.body['currency']).toMatchObject({ pact: 'JPY', declared: 'JPY', detected: ['JPY'], readAs: 'JPY', question: null });
    const imported = await call('POST', `/v1/deals/${pact.dealId}/uploads/${id}/import`, { mapping: { ...mapping, currency: 'JPY' } });
    expect(imported.body, JSON.stringify(imported.body)).toMatchObject({ syncRun: { status: 'SUCCEEDED', recordsCreated: 6 } });
    const rows = await db.owner.query(`SELECT canonical FROM evidence_items WHERE deal_id = $1 AND evidence_type = 'finance.pnl_line' ORDER BY canonical->>'account', canonical->>'month'`, [pact.dealId]);
    expect(rows.rows.map((row) => (row as { canonical: Body }).canonical['currency'])).toEqual(Array(6).fill('JPY'));
  });
});
