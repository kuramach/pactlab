import 'reflect-metadata';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
import { parseCsv } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { FileSystemObjectStore } from '../documents/storage-adapters';
import { SignatureMalwareScanner } from '../documents/upload-policy';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

const FIXTURE = new URL('../../../../fixtures/synthetic/HealthyCo/stripe-invoice-lines.csv', import.meta.url);

/** The HealthyCo export rewritten the way a European SAP extract looks. */
function asSapExport(csv: string): string {
  const table = parseCsv(csv);
  const at = (cells: readonly string[], name: string) => cells[table.header.indexOf(name)] ?? '';
  const date = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
  const amount = (value: string) => {
    const [integer = '0', fraction = '00'] = value.split('.');
    return `"${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction.padEnd(2, '0')}"`;
  };
  const frequency: Record<string, string> = { month: 'Monthly', year: 'Annual', '': '' };
  const header = 'Billing Document Item,Billing Document,Sold-To Party,Net Value,Document Currency,Billing Frequency,Service Start,Service End,Billing Date';
  const rows = table.rows.map(({ cells }) =>
    [
      at(cells, 'line_id'),
      at(cells, 'invoice_id'),
      at(cells, 'customer_id'),
      amount(at(cells, 'amount')),
      at(cells, 'currency'),
      frequency[at(cells, 'interval')] ?? '',
      date(at(cells, 'period_start')),
      date(at(cells, 'period_end')),
      date(at(cells, 'created')),
    ].join(','),
  );
  return [header, ...rows].join('\n') + '\n';
}

const SAP_MAPPING = {
  target: 'BILLING_INVOICE_LINE',
  fields: {
    line_id: { kind: 'column', column: 'Billing Document Item' },
    invoice_id: { kind: 'column', column: 'Billing Document' },
    customer_id: { kind: 'column', column: 'Sold-To Party' },
    amount: { kind: 'column', column: 'Net Value' },
    currency: { kind: 'column', column: 'Document Currency' },
    interval: { kind: 'column', column: 'Billing Frequency' },
    period_start: { kind: 'column', column: 'Service Start' },
    period_end: { kind: 'column', column: 'Service End' },
    created: { kind: 'column', column: 'Billing Date' },
    invoice_status: { kind: 'constant', value: 'paid' },
  },
  dateFormat: 'DD.MM.YYYY',
  numberFormat: 'COMMA_DECIMAL',
  amountUnit: 'MAJOR',
  negateAmounts: false,
};

// Each test uploads, previews and imports through the full API on an in-process database: seconds, not
// milliseconds, and slower on CI runners than locally — the 5 s default timed out on CI.
describe('billing CSV import through the API', { timeout: 30_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let storeDir: string;
  let standard: SyntheticTenant;
  let sap: SyntheticTenant;
  let outsider: SyntheticTenant;
  let signingKey: CryptoKey;
  let csv: string;

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey);

  async function call(method: 'GET' | 'POST', url: string, bearer: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  async function upload(tenant: SyntheticTenant, bearer: string, content: string | Buffer, system: string, fileName = 'billing.csv') {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/deals/${tenant.dealId}/uploads?system=${system}&fileName=${encodeURIComponent(fileName)}`,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'text/csv' },
      payload: content,
    });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    standard = await createSyntheticTenant(db.owner, 'Alpha');
    sap = await createSyntheticTenant(db.owner, 'Sierra');
    outsider = await createSyntheticTenant(db.owner, 'Bravo');
    storeDir = await mkdtemp(join(tmpdir(), 'pactlab-uploads-'));
    csv = await readFile(FIXTURE, 'utf8');
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      uploads: { objectStore: new FileSystemObjectStore(storeDir), malwareScanner: new SignatureMalwareScanner() },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
    if (storeDir) await rm(storeDir, { recursive: true, force: true });
  });

  it('lists the pack\'s import targets with their templates (ADR 0010); billing for a software deal', async () => {
    const bearer = await token(standard.subject, standard);
    const targets = await call('GET', `/v1/deals/${standard.dealId}/import-targets`, bearer);
    expect(targets.status).toBe(200);
    const items = targets.body['items'] as { target: string; label: string; people: string; templateCsv: string }[];
    expect(items.map((item) => [item.target, item.label, item.people])).toEqual([['BILLING_INVOICE_LINE', 'Invoice lines', 'NONE']]);
    expect(items[0]?.templateCsv.startsWith('line_id,invoice_id,customer_id,')).toBe(true);
    const template = await app.inject({ method: 'GET', url: `/v1/deals/${standard.dealId}/import-targets/BILLING_INVOICE_LINE/template.csv`, headers: { authorization: `Bearer ${bearer}` } });
    expect(template.statusCode).toBe(200);
    expect(template.headers['content-type']).toContain('text/csv');
    expect(template.body).toBe(items[0]?.templateCsv);
    expect((await call('GET', `/v1/deals/${standard.dealId}/import-targets/RENT_ROLL/template.csv`, bearer)).status).toBe(400);
    expect((await call('GET', `/v1/deals/${standard.dealId}/import-targets`, await token(outsider.subject, outsider))).status).toBe(404);
  });

  it('an explicit billing target behaves exactly like no target; an unknown target is refused', async () => {
    const bearer = await token(standard.subject, standard);
    const explicit = await app.inject({
      method: 'POST',
      url: `/v1/deals/${standard.dealId}/uploads?system=pactlab_standard&fileName=billing.csv&target=BILLING_INVOICE_LINE`,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'text/csv' },
      payload: csv,
    });
    expect(explicit.statusCode).toBe(201);
    expect(explicit.json()).toMatchObject({ target: 'BILLING_INVOICE_LINE', system: 'pactlab_standard' });
    const unknown = await app.inject({
      method: 'POST',
      url: `/v1/deals/${standard.dealId}/uploads?system=pactlab_standard&fileName=x.csv&target=RENT_ROLL`,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'text/csv' },
      payload: csv,
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('cancels a wrong upload: nothing imported, the stored copy deleted, audited; an imported upload cannot be cancelled', async () => {
    // Its own tenant, so the other tests' evidence counts are untouched.
    const own = await createSyntheticTenant(db.owner, 'Cancel');
    const bearer = await token(own.subject, own);
    const uploaded = await upload(own, bearer, csv, 'pactlab_standard', 'wrong-file.csv');
    expect(uploaded.status).toBe(201);
    const id = uploaded.body['id'] as string;
    const cancelled = await call('POST', `/v1/deals/${own.dealId}/uploads/${id}/cancel`, bearer);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ id, status: 'PURGED' });
    // Idempotent, and the file is gone: it can no longer be read, previewed or imported.
    expect((await call('POST', `/v1/deals/${own.dealId}/uploads/${id}/cancel`, bearer)).body).toMatchObject({ status: 'PURGED' });
    const detail = await call('GET', `/v1/deals/${own.dealId}/uploads/${id}`, bearer);
    expect(detail.status).toBe(409);
    const audit = (await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE target_id = $1 AND action = 'source_upload.cancelled'`, [id])) as { rows: { n: number }[] };
    expect(audit.rows[0]?.n).toBe(1);
    // Another tenant cannot cancel it.
    expect((await call('POST', `/v1/deals/${own.dealId}/uploads/${id}/cancel`, await token(outsider.subject, outsider))).status).toBe(404);

    // An imported upload's evidence stays: cancelling it is refused.
    const kept = await upload(own, bearer, csv, 'pactlab_standard', 'kept.csv');
    const keptId = kept.body['id'] as string;
    const imported = await call('POST', `/v1/deals/${own.dealId}/uploads/${keptId}/import`, bearer, { mapping: kept.body['suggestedMapping'] });
    expect(imported.status).toBe(200);
    expect((await call('POST', `/v1/deals/${own.dealId}/uploads/${keptId}/cancel`, bearer)).status).toBe(409);
  });

  it('lists billing systems and says which have verified column templates', async () => {
    const systems = (await call('GET', '/v1/billing-import/systems', await token(standard.subject, standard))).body['items'] as Body[];
    const bySystem = Object.fromEntries(systems.map((entry) => [entry['system'], entry['verified']]));
    expect(bySystem).toMatchObject({ stripe: true, pactlab_standard: true, sap_s4hana: false, oracle_fusion: false, netsuite: false });
  });

  it('uploads, previews and imports a standard export; replaying it creates nothing new', async () => {
    const lead = await token(standard.subject, standard);
    const uploaded = await upload(standard, lead, csv, 'pactlab_standard', 'healthyco.csv');
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({ system: 'pactlab_standard', rowCount: 84, status: 'UPLOADED', visibility: 'BUYER_ONLY' });
    const mapping = uploaded.body['suggestedMapping'] as Body;
    expect((mapping['fields'] as Body)['amount']).toEqual({ kind: 'column', column: 'amount' });

    const uploadId = uploaded.body['id'] as string;
    const base = `/v1/deals/${standard.dealId}/uploads/${uploadId}`;
    const preview = await call('POST', `${base}/preview`, lead, { mapping });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ problems: [], rowCount: 84, validRows: 84, issues: [] });
    expect(preview.body['totals']).toEqual([expect.objectContaining({ currency: 'USD', lines: 84 })]);
    expect(await db.owner.query(`SELECT count(*)::int AS n FROM evidence_items WHERE deal_id = $1`, [standard.dealId])).toMatchObject({
      rows: [{ n: 0 }],
    });

    const imported = await call('POST', `${base}/import`, lead, { mapping });
    expect(imported.status).toBe(200);
    expect(imported.body).toMatchObject({ replayed: false, syncRun: { status: 'SUCCEEDED', recordsSeen: 84, recordsCreated: 84 } });
    expect((imported.body['upload'] as Body)['status']).toBe('IMPORTED');

    const again = await call('POST', `${base}/import`, lead, { mapping });
    expect(again.body).toMatchObject({ replayed: true });
    const evidence = (await db.owner.query(
      `SELECT count(DISTINCT e.id)::int AS n, min(c.locator->>'dataset') AS dataset
         FROM evidence_items e JOIN citations c ON c.evidence_item_id = e.id WHERE e.deal_id = $1`,
      [standard.dealId],
    )) as { rows: { n: number; dataset: string }[] };
    expect(evidence.rows[0]).toEqual({ n: 84, dataset: `uploads/${uploadId}/healthyco.csv` });

    // The identical file uploaded again replays the first import.
    const same = await upload(standard, lead, csv, 'pactlab_standard', 'healthyco-again.csv');
    expect((await call('POST', `/v1/deals/${standard.dealId}/uploads/${same.body['id'] as string}/import`, lead, { mapping })).body).toMatchObject({
      replayed: true,
    });

    // A newer export adds only what changed; earlier lines are recognised record by record.
    const newer = `${csv}il_hc_new01,in_hc_new,hc-cus-0001,Aurora Logistics (synthetic),sub_hc_0001,price_hc_growth_m,USD,3400.00,month,1,2026-10-01,2026-11-01,paid,2026-10-01\n`;
    const second = await upload(standard, lead, newer, 'pactlab_standard', 'healthyco-october.csv');
    const reimport = await call('POST', `/v1/deals/${standard.dealId}/uploads/${second.body['id'] as string}/import`, lead, { mapping });
    expect(reimport.body).toMatchObject({ replayed: false, syncRun: { status: 'SUCCEEDED', recordsCreated: 1, recordsUnchanged: 84 } });

    const sources = (await call('GET', `/v1/deals/${standard.dealId}/source-plan`, lead)).body['sources'] as Body[];
    expect(sources[0]).toMatchObject({ kind: 'BILLING', status: 'CONNECTED' });
  });

  it('imports the FreshCo test kit billing file into a fresh deal with the expected ARR', async () => {
    const fresh = await createSyntheticTenant(db.owner, 'Fresh');
    const lead = await token(fresh.subject, fresh);
    const kit = await readFile(new URL('../../../../fixtures/test-kit/FreshCo/generated/stripe-invoice-lines.csv', import.meta.url), 'utf8');
    const uploaded = await upload(fresh, lead, kit, 'pactlab_standard', 'freshco.csv');
    expect(uploaded.status).toBe(201);
    const mapping = uploaded.body['suggestedMapping'] as Body;
    const base = `/v1/deals/${fresh.dealId}/uploads/${uploaded.body['id'] as string}`;
    expect((await call('POST', `${base}/preview`, lead, { mapping })).body).toMatchObject({ problems: [], issues: [] });
    expect((await call('POST', `${base}/import`, lead, { mapping })).body).toMatchObject({ syncRun: { status: 'SUCCEEDED' } });
    const summary = await call('GET', `/v1/deals/${fresh.dealId}/metrics/summary?asOf=2026-09`, lead);
    const metric = (key: string) => ((summary.body['report'] as Body)['metrics'] as Body[]).find((entry) => entry['key'] === key)?.['value'];
    // README: 10 active customers, MRR 59,600 → ARR 715,200 at September 2026.
    expect(metric('ARR')).toBe('715200.00');
    expect(metric('ACTIVE_CUSTOMERS')).toBe('10');
  });

  it('turns a SAP-style export into the same ARR as the standard file', async () => {
    const lead = await token(sap.subject, sap);
    const uploaded = await upload(sap, lead, asSapExport(csv), 'sap_s4hana', 'sap-billing.csv');
    expect(uploaded.status).toBe(201);
    expect((uploaded.body['template'] as Body)['verified']).toBe(false);
    const suggested = uploaded.body['suggestedMapping'] as Body;
    expect(suggested['dateFormat']).toBe('DD.MM.YYYY');
    expect((suggested['fields'] as Body)['customer_id']).toEqual({ kind: 'column', column: 'Sold-To Party' });

    const base = `/v1/deals/${sap.dealId}/uploads/${uploaded.body['id'] as string}`;
    expect((await call('POST', `${base}/preview`, lead, { mapping: SAP_MAPPING })).body).toMatchObject({ validRows: 84, issues: [] });
    expect((await call('POST', `${base}/import`, lead, { mapping: SAP_MAPPING })).body).toMatchObject({
      syncRun: { status: 'SUCCEEDED', recordsCreated: 84 },
    });

    const asOf = '2026-09';
    const standardReport = (await call('GET', `/v1/deals/${standard.dealId}/metrics/summary?asOf=${asOf}`, await token(standard.subject, standard)))
      .body['report'] as Body;
    const sapReport = (await call('GET', `/v1/deals/${sap.dealId}/metrics/summary?asOf=${asOf}`, lead)).body['report'] as Body;
    expect(sapReport['series']).toEqual(standardReport['series']);
    expect((sapReport['series'] as Body[]).length).toBeGreaterThan(0);
  });

  it('reports mapping problems in preview and refuses to import them', async () => {
    const lead = await token(standard.subject, standard);
    const uploaded = await upload(standard, lead, 'id,total\n1,10\n', 'other');
    const base = `/v1/deals/${standard.dealId}/uploads/${uploaded.body['id'] as string}`;
    const mapping = { ...SAP_MAPPING, fields: { line_id: { kind: 'column', column: 'id' }, amount: { kind: 'column', column: 'total' } } };
    const preview = await call('POST', `${base}/preview`, lead, { mapping });
    expect(preview.body['problems']).toEqual(['Currency is required']);
    expect((await call('POST', `${base}/import`, lead, { mapping })).status).toBe(422);
  });

  it('rejects malware, binary, malformed and oversized files, and non-billing systems', async () => {
    const lead = await token(standard.subject, standard);
    const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    expect((await upload(standard, lead, `a,b\n${eicar},1\n`, 'other')).status).toBe(422);
    const binary = await upload(standard, lead, Buffer.from([0x61, 0x2c, 0x62, 0x0a, 0x00, 0xfe, 0x0a]), 'other');
    expect(binary).toMatchObject({ status: 415, body: { code: 'NOT_TEXT' } });
    expect((await upload(standard, lead, 'a,b\n1,2,3\n', 'other')).status).toBe(422);
    expect((await upload(standard, lead, Buffer.alloc(50 * 1024 * 1024 + 1, 0x61), 'other')).status).toBe(413);
    expect((await upload(standard, lead, 'a\n1\n', 'github')).status).toBe(400);
    expect((await upload(standard, lead, 'a\n1\n', 'jira')).status).toBe(400);
  });

  it('lets contributors upload shared exports, refuses viewers and hides uploads from other tenants', async () => {
    const viewer = await addSyntheticDealMember(db.owner, standard, 'VIEWER');
    const contributor = await addSyntheticDealMember(db.owner, standard, 'TARGET_CONTRIBUTOR');
    expect((await upload(standard, await token(viewer.subject, standard), csv, 'stripe')).status).toBe(403);
    const shared = await upload(standard, await token(contributor.subject, standard), 'id,amount\n1,1\n', 'stripe');
    expect(shared.body).toMatchObject({ visibility: 'SHARED' });
    const contributorList = (await call('GET', `/v1/deals/${standard.dealId}/uploads`, await token(contributor.subject, standard))).body[
      'items'
    ] as Body[];
    expect(contributorList.map((item) => item['id'])).toEqual([shared.body['id']]);

    const stranger = await token(outsider.subject, outsider);
    expect((await call('GET', `/v1/deals/${standard.dealId}/uploads`, stranger)).status).toBe(404);
    expect((await upload(standard, stranger, csv, 'stripe')).status).toBe(404);
  });
});
