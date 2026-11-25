import 'reflect-metadata';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
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
const AS_OF = '2026-06';
type Body = Record<string, unknown>;

const FIXTURE = new URL('../../../../fixtures/synthetic/HealthyCo/stripe-invoice-lines.csv', import.meta.url);

/** The same export with every amount doubled (exact, in cents): the corrected file a seller sends next. */
function doubled(csv: string): string {
  const table = parseCsv(csv);
  const amount = table.header.indexOf('amount');
  const twice = (value: string) => {
    const cents = BigInt(value.replace('.', '')) * 2n;
    return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  };
  const rows = table.rows.map(({ cells }) => cells.map((cell, index) => (index === amount ? twice(cell) : cell)).map((cell) => (cell.includes(',') ? `"${cell}"` : cell)).join(','));
  return [table.header.join(','), ...rows].join('\n') + '\n';
}

// The whole journey runs through the API on an in-process database: seconds per test.
describe('withdraw an import and re-import (T-154)', { timeout: 60_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let storeDir: string;
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

  async function call(method: 'GET' | 'POST' | 'PUT', url: string, bearer: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  async function send(url: string, bearer: string, content: string) {
    const response = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${bearer}`, 'content-type': 'text/csv' }, payload: content });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  async function importFile(tenant: SyntheticTenant, bearer: string, detail: Body) {
    const imported = await call('POST', `/v1/deals/${tenant.dealId}/uploads/${detail['id'] as string}/import`, bearer, { mapping: detail['suggestedMapping'] as Body });
    expect(imported.status).toBe(200);
    expect((imported.body['syncRun'] as Body)['status']).toBe('SUCCEEDED');
    return imported.body;
  }

  const arr = async (tenant: SyntheticTenant, bearer: string) => {
    const summary = await call('GET', `/v1/deals/${tenant.dealId}/metrics/summary?asOf=${AS_OF}`, bearer);
    return ((summary.body['report'] as Body | undefined)?.['metrics'] as Body[] | undefined)?.find((entry) => entry['key'] === 'ARR')?.['value'] ?? null;
  };
  const invoiceLines = async (tenant: SyntheticTenant, bearer: string) =>
    (await call('GET', `/v1/deals/${tenant.dealId}/evidence?type=billing.invoice_line&limit=100`, bearer)).body as { items: { id: string }[]; total: number };
  const audited = async (action: string, targetId: string) =>
    ((await db.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = $1 AND target_id = $2`, [action, targetId])) as { rows: { n: number }[] }).rows[0]?.n ?? 0;

  beforeAll(async () => {
    db = await startTestDatabase();
    storeDir = await mkdtemp(join(tmpdir(), 'pactlab-withdraw-'));
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

  it('import → value it → withdraw: the data stops counting, what used it is flagged, the record stays; re-import reads the new file', async () => {
    const tenant = await createSyntheticTenant(db.owner, 'Withdraw');
    const lead = await token(tenant.subject, tenant);
    const analyst = await token((await addSyntheticDealMember(db.owner, tenant, 'ANALYST')).subject, tenant);
    const reviewer = await token((await addSyntheticDealMember(db.owner, tenant, 'REVIEWER')).subject, tenant);
    const viewer = await token((await addSyntheticDealMember(db.owner, tenant, 'VIEWER')).subject, tenant);
    const contributor = await token((await addSyntheticDealMember(db.owner, tenant, 'TARGET_CONTRIBUTOR')).subject, tenant);
    const base = `/v1/deals/${tenant.dealId}`;

    // 1. Import a billing export; metrics read it.
    const v1 = (await send(`${base}/uploads?system=pactlab_standard&fileName=billing-wrong.csv`, lead, csv)).body;
    await importFile(tenant, lead, v1);
    const v1Id = v1['id'] as string;
    const before = await arr(tenant, lead);
    expect(before).not.toBeNull();
    const lines = await invoiceLines(tenant, lead);
    expect(lines.total).toBe(84);

    // 2. A finding cites one of its rows and prices a risk; a valuation run consumes it.
    const created = await call('POST', `${base}/findings`, analyst, {
      domain: 'FINANCIAL',
      title: 'Discounted renewal on the largest customer',
      description: 'The renewal line is priced below list.',
      severity: 'MEDIUM',
      confidence: 'HIGH',
      evidence: [{ evidenceItemId: lines.items[0]!.id, commitSha: null, toolName: 'billing-review', toolVersion: '1', rulesetVersion: null, path: null, lineStart: null, lineEnd: null }],
      pricedRisk: { type: 'PRICE_REDUCTION', currency: 'USD', low: '100000', high: '300000', basis: 'Renewal gap' },
      direction: -1,
    });
    expect(created.status).toBe(201);
    const findingId = created.body['id'] as string;
    await call('POST', `${base}/findings/${findingId}/reviews`, analyst, { expectedVersion: 1, decision: 'SUBMITTED', rationale: 'Ready' });
    expect((await call('POST', `${base}/findings/${findingId}/reviews`, reviewer, { expectedVersion: 2, decision: 'ACCEPTED', rationale: 'Checked' })).status).toBe(201);
    const scenario = await call('POST', `${base}/valuation/scenarios`, analyst, {
      name: 'Base case',
      values: {
        assumptions: { method: 'ARR_MULTIPLE', arr: '10000000.00', multiple: '6.5' },
        bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
        findingLinks: [{ findingId, point: 'MID' }],
      },
    });
    expect(scenario.status).toBe(201);
    const scenarioId = (scenario.body['scenario'] as Body)['id'] as string;
    const ran = await call('POST', `${base}/valuation/scenarios/${scenarioId}/runs`, analyst, { expectedVersion: 1 });
    expect(ran.status).toBe(201);
    const firstRun = ran.body['latestRun'] as Body;
    expect(ran.body['sourceWithdrawn']).toEqual([]);

    // 3. Only manage rights withdraw, and only with a reason.
    expect((await call('POST', `${base}/uploads/${v1Id}/withdraw`, viewer, { reason: 'Wrong file' })).status).toBe(403);
    expect([403, 404]).toContain((await call('POST', `${base}/uploads/${v1Id}/withdraw`, contributor, { reason: 'Wrong file' })).status);
    expect((await call('POST', `${base}/uploads/${v1Id}/withdraw`, lead, { reason: ' ' })).status).toBe(400);
    expect((await call('GET', `${base}/uploads/${v1Id}`, lead)).body['status']).toBe('IMPORTED');

    const withdrawn = await call('POST', `${base}/uploads/${v1Id}/withdraw`, analyst, { reason: 'Wrong month exported' });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body['result']).toEqual({ voidedRecords: 84, flaggedFindings: 1, flaggedValuationRuns: 1 });
    expect(withdrawn.body['upload']).toMatchObject({ id: v1Id, status: 'WITHDRAWN', withdrawal: { reason: 'Wrong month exported' } });
    expect((await call('POST', `${base}/uploads/${v1Id}/withdraw`, lead, { reason: 'Again' })).status).toBe(409);
    expect((await call('POST', `${base}/uploads/${v1Id}/import`, lead, { mapping: v1['suggestedMapping'] as Body })).status).toBe(409);

    // 4. Its rows stop counting: metrics, the evidence browser, new citations.
    expect(await arr(tenant, lead)).not.toBe(before);
    expect((await invoiceLines(tenant, lead)).total).toBe(0);
    const stored = (await db.owner.query(`SELECT count(*)::int AS n FROM evidence_items WHERE deal_id = $1 AND evidence_type = 'billing.invoice_line'`, [tenant.dealId])) as { rows: { n: number }[] };
    expect(stored.rows[0]?.n).toBe(84);
    // The voided row still resolves by id, so what was seen can be explained.
    expect((await call('GET', `${base}/evidence/${lines.items[0]!.id}`, lead)).status).toBe(200);
    const recite = await call('POST', `${base}/findings`, analyst, {
      domain: 'FINANCIAL', title: 'Cites withdrawn data', description: 'x', severity: 'LOW', confidence: 'LOW',
      evidence: [{ evidenceItemId: lines.items[1]!.id, commitSha: null, toolName: 't', toolVersion: '1', rulesetVersion: null, path: null, lineStart: null, lineEnd: null }],
    });
    expect(recite.status).toBe(422);

    // 5. The finding and the run are flagged, not changed.
    const finding = await call('GET', `${base}/findings/${findingId}`, lead);
    expect(finding.body['sourceWithdrawn']).toEqual([expect.objectContaining({ uploadId: v1Id, fileName: 'billing-wrong.csv', reason: 'Wrong month exported' })]);
    expect((finding.body['finding'] as Body)['status']).toBe('ACCEPTED');
    const listed = (await call('GET', `${base}/findings`, lead)).body['items'] as Body[];
    expect(listed.find((item) => item['id'] === findingId)?.['sourceWithdrawn']).toHaveLength(1);
    const flagged = await call('GET', `${base}/valuation/scenarios/${scenarioId}`, lead);
    expect(flagged.body['latestRun']).toEqual(firstRun);
    expect(flagged.body['sourceWithdrawn']).toEqual([expect.objectContaining({ uploadId: v1Id })]);

    // 6. Every transition is in the pact's audit chain, with the affected artefacts.
    expect(await audited('source_upload.created', v1Id)).toBe(1);
    expect(await audited('source_upload.withdrawn', v1Id)).toBe(1);
    expect(await audited('finding.source_withdrawn', findingId)).toBe(1);
    expect(await audited('valuation_run.source_withdrawn', firstRun['id'] as string)).toBe(1);

    // 7. Re-import the corrected file: a new import linked to the withdrawn one, its mapping offered again.
    expect((await send(`${base}/uploads/${v1Id}/reimport?fileName=billing-fixed.csv`, viewer, doubled(csv))).status).toBe(403);
    const v2 = (await send(`${base}/uploads/${v1Id}/reimport?fileName=billing-fixed.csv`, lead, doubled(csv)));
    expect(v2.status).toBe(201);
    const v2Id = v2.body['id'] as string;
    expect(v2.body).toMatchObject({ status: 'UPLOADED', supersedesUploadId: v1Id, fileName: 'billing-fixed.csv', target: 'BILLING_INVOICE_LINE' });
    expect(v2.body['suggestedMapping']).toEqual((await call('GET', `${base}/uploads/${v1Id}`, lead)).body['suggestedMapping']);
    expect((await send(`${base}/uploads/${v1Id}/reimport`, lead, csv)).status).toBe(409);
    await importFile(tenant, lead, v2.body);
    expect(await audited('source_upload.reimported', v2Id)).toBe(1);
    expect(await audited('source_upload.superseded', v1Id)).toBe(1);

    // 8. The fresh data counts (twice the amounts → twice the ARR); lineage links both ways.
    const after = await arr(tenant, lead);
    expect(Number(after)).toBe(Number(before) * 2);
    expect((await invoiceLines(tenant, lead)).total).toBe(84);
    expect((await call('GET', `${base}/uploads/${v1Id}`, lead)).body).toMatchObject({ status: 'WITHDRAWN', supersededByUploadId: v2Id });
    const history = await call('GET', `${base}/uploads/${v2Id}/history`, lead);
    expect(history.status).toBe(200);
    expect(history.body['chain']).toEqual([
      expect.objectContaining({ uploadId: v1Id, version: 1, status: 'WITHDRAWN', voidedRecords: 84, withdrawal: expect.objectContaining({ reason: 'Wrong month exported' }) }),
      expect.objectContaining({ uploadId: v2Id, version: 2, status: 'IMPORTED', withdrawal: null, voidedRecords: 0 }),
    ]);
    expect((await call('GET', `${base}/uploads/${v2Id}/history`, viewer)).status).toBe(403);

    // 9. A fresh run is not flagged; the earlier one keeps its history.
    const rerun = await call('POST', `${base}/valuation/scenarios/${scenarioId}/runs`, analyst, { expectedVersion: 2 });
    expect(rerun.status).toBe(201);
    expect(rerun.body['sourceWithdrawn']).toEqual([]);
    const runs = (await db.owner.query(`SELECT id::text FROM valuation_runs WHERE scenario_id = $1 ORDER BY ran_at`, [scenarioId])) as { rows: { id: string }[] };
    expect(runs.rows.map((row) => row.id)).toEqual([firstRun['id'], (rerun.body['latestRun'] as Body)['id']]);
  });

  it('whoever imported a file can delete it and import it again; only the deal lead or an analyst can delete someone else\'s', async () => {
    const tenant = await createSyntheticTenant(db.owner, 'Own import');
    const lead = await token(tenant.subject, tenant);
    const analyst = await token((await addSyntheticDealMember(db.owner, tenant, 'ANALYST')).subject, tenant);
    const reviewer = await token((await addSyntheticDealMember(db.owner, tenant, 'REVIEWER')).subject, tenant);
    const seller = await token((await addSyntheticDealMember(db.owner, tenant, 'TARGET_CONTRIBUTOR')).subject, tenant);
    const otherSeller = await token((await addSyntheticDealMember(db.owner, tenant, 'TARGET_CONTRIBUTOR')).subject, tenant);
    const base = `/v1/deals/${tenant.dealId}`;

    // The seller imports a billing export; the buyer builds an accepted finding and a valuation run on it.
    const mine = (await send(`${base}/uploads?system=pactlab_standard&fileName=seller-billing.csv`, seller, csv)).body;
    await importFile(tenant, seller, mine);
    const mineId = mine['id'] as string;
    const lines = await invoiceLines(tenant, lead);
    const created = await call('POST', `${base}/findings`, analyst, {
      domain: 'FINANCIAL', title: 'Renewal priced below list', description: 'x', severity: 'MEDIUM', confidence: 'HIGH',
      evidence: [{ evidenceItemId: lines.items[0]!.id, commitSha: null, toolName: 'billing-review', toolVersion: '1', rulesetVersion: null, path: null, lineStart: null, lineEnd: null }],
      pricedRisk: { type: 'PRICE_REDUCTION', currency: 'USD', low: '100000', high: '300000', basis: 'Renewal gap' },
      direction: -1,
    });
    const findingId = created.body['id'] as string;
    await call('POST', `${base}/findings/${findingId}/reviews`, analyst, { expectedVersion: 1, decision: 'SUBMITTED', rationale: 'Ready' });
    await call('POST', `${base}/findings/${findingId}/reviews`, reviewer, { expectedVersion: 2, decision: 'ACCEPTED', rationale: 'Checked' });
    const scenario = await call('POST', `${base}/valuation/scenarios`, analyst, {
      name: 'Base case',
      values: { assumptions: { method: 'ARR_MULTIPLE', arr: '10000000.00', multiple: '6.5' }, bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' }, findingLinks: [{ findingId, point: 'MID' }] },
    });
    const scenarioId = (scenario.body['scenario'] as Body)['id'] as string;
    const run = ((await call('POST', `${base}/valuation/scenarios/${scenarioId}/runs`, analyst, { expectedVersion: 1 })).body['latestRun'] as Body)['id'] as string;

    // The buyer's own import, which the seller cannot see or delete.
    const buyers = (await send(`${base}/uploads?system=pactlab_standard&fileName=buyer-billing.csv`, lead, doubled(csv))).body;
    await importFile(tenant, lead, buyers);
    const buyersId = buyers['id'] as string;

    // Who may delete what, as the screens are told.
    const sellerList = (await call('GET', `${base}/uploads`, seller)).body['items'] as Body[];
    expect(sellerList.find((item) => item['id'] === mineId)?.['canDelete']).toBe(true);
    expect(((await call('GET', `${base}/uploads`, otherSeller)).body['items'] as Body[]).find((item) => item['id'] === mineId)?.['canDelete']).toBe(false);
    expect(((await call('GET', `${base}/uploads`, analyst)).body['items'] as Body[]).every((item) => item['canDelete'] === true)).toBe(true);
    expect(((await call('GET', `${base}/uploads`, reviewer)).body['items'] as Body[]).every((item) => item['canDelete'] === false)).toBe(true);
    expect((await call('GET', `${base}/uploads/${mineId}`, seller)).body['canDelete']).toBe(true);

    // Not someone else's.
    expect((await call('POST', `${base}/uploads/${mineId}/withdraw`, otherSeller, { reason: 'Not mine' })).status).toBe(403);
    expect([403, 404]).toContain((await call('POST', `${base}/uploads/${buyersId}/withdraw`, seller, { reason: 'Not mine' })).status);
    expect((await call('POST', `${base}/uploads/${mineId}/withdraw`, reviewer, { reason: 'No rights' })).status).toBe(403);

    // Their own: deleted, and everything built on it is found and flagged, though the seller cannot see it.
    const deleted = await call('POST', `${base}/uploads/${mineId}/withdraw`, seller, { reason: 'Columns read wrongly' });
    expect(deleted.status).toBe(200);
    expect(deleted.body['result']).toEqual({ voidedRecords: 84, flaggedFindings: 1, flaggedValuationRuns: 1 });
    expect(deleted.body['upload']).toMatchObject({ id: mineId, status: 'WITHDRAWN', withdrawal: { reason: 'Columns read wrongly' } });
    expect((await call('POST', `${base}/uploads/${mineId}/withdraw`, seller, { reason: 'Again' })).status).toBe(409);
    expect(await audited('source_upload.withdrawn', mineId)).toBe(1);
    expect(await audited('finding.source_withdrawn', findingId)).toBe(1);
    expect(await audited('valuation_run.source_withdrawn', run)).toBe(1);
    expect((await call('GET', `${base}/findings/${findingId}`, lead)).body['sourceWithdrawn']).toEqual([expect.objectContaining({ uploadId: mineId, reason: 'Columns read wrongly' })]);
    // The buyer's import is untouched.
    expect((await call('GET', `${base}/uploads/${buyersId}`, lead)).body['status']).toBe('IMPORTED');

    // And imports it again; its history is theirs to see, not the other seller's.
    expect((await call('POST', `${base}/uploads/${mineId}/reimport`, otherSeller, {})).status).toBe(403);
    const again = await call('POST', `${base}/uploads/${mineId}/reimport`, seller, {});
    expect(again.status).toBe(201);
    await importFile(tenant, seller, again.body);
    expect((await call('GET', `${base}/uploads/${again.body['id'] as string}/history`, seller)).status).toBe(200);
    expect((await call('GET', `${base}/uploads/${again.body['id'] as string}/history`, otherSeller)).status).toBe(403);

    // The deal lead can delete the seller's.
    expect((await call('POST', `${base}/uploads/${again.body['id'] as string}/withdraw`, lead, { reason: 'Superseded by data room copy' })).status).toBe(200);
  });

  it('re-importing the same rows restores them: the voids stay as history, naming the import that restored them', async () => {
    const tenant = await createSyntheticTenant(db.owner, 'Restore');
    const lead = await token(tenant.subject, tenant);
    const base = `/v1/deals/${tenant.dealId}`;
    const v1 = (await send(`${base}/uploads?system=pactlab_standard&fileName=billing.csv`, lead, csv)).body;
    await importFile(tenant, lead, v1);
    const before = await arr(tenant, lead);
    const v1Id = v1['id'] as string;
    expect((await call('POST', `${base}/uploads/${v1Id}/withdraw`, lead, { reason: 'Mapped the wrong currency' })).status).toBe(200);
    expect((await invoiceLines(tenant, lead)).total).toBe(0);

    // No file: the stored original is read again under a new import.
    const v2 = await call('POST', `${base}/uploads/${v1Id}/reimport`, lead, {});
    expect(v2.status).toBe(201);
    expect(v2.body['supersedesUploadId']).toBe(v1Id);
    const imported = await importFile(tenant, lead, v2.body);
    expect(imported['replayed']).toBe(false);
    expect(await arr(tenant, lead)).toBe(before);
    expect((await invoiceLines(tenant, lead)).total).toBe(84);
    const voids = (await db.owner.query(`SELECT count(*)::int AS n, count(restored_at)::int AS restored, min(restored_by_upload_id::text) AS by FROM evidence_voids WHERE source_upload_id = $1`, [v1Id])) as {
      rows: { n: number; restored: number; by: string }[];
    };
    expect(voids.rows[0]).toEqual({ n: 84, restored: 84, by: v2.body['id'] });
  });

  it('records another active import still reads are not voided; an import never imported is cancelled, not withdrawn', async () => {
    const tenant = await createSyntheticTenant(db.owner, 'Shared rows');
    const lead = await token(tenant.subject, tenant);
    const base = `/v1/deals/${tenant.dealId}`;
    const first = (await send(`${base}/uploads?system=pactlab_standard&fileName=jan.csv`, lead, csv)).body;
    await importFile(tenant, lead, first);
    // The same rows in a second export with one more line: both imports hold the 84 shared rows.
    const extra = `${csv.trimEnd()}\nil_hc_99999,in_hc_209901_0001,hc-cus-0001,Aurora Logistics (synthetic),sub_hc_0001,price_hc_growth_m,USD,10.00,month,1,2026-06-01,2026-07-01,paid,2026-06-01\n`;
    const second = (await send(`${base}/uploads?system=pactlab_standard&fileName=feb.csv`, lead, extra)).body;
    await importFile(tenant, lead, second);
    expect((await invoiceLines(tenant, lead)).total).toBe(85);
    const withdrawn = await call('POST', `${base}/uploads/${second['id'] as string}/withdraw`, lead, { reason: 'Duplicate export' });
    expect(withdrawn.body['result']).toMatchObject({ voidedRecords: 1 });
    expect((await invoiceLines(tenant, lead)).total).toBe(84);
    // Deleting the pact later purges every stored file, a withdrawn import's too; its withdrawal record stays.
    await db.owner.query(`UPDATE source_uploads SET status = 'PURGED', object_key = NULL, purged_at = now() WHERE id = $1`, [second['id']]);
    const purged = (await db.owner.query(`SELECT withdrawal_reason FROM source_uploads WHERE id = $1`, [second['id']])) as { rows: { withdrawal_reason: string }[] };
    expect(purged.rows[0]?.withdrawal_reason).toBe('Duplicate export');

    const pending = (await send(`${base}/uploads?system=pactlab_standard&fileName=pending.csv`, lead, csv)).body;
    expect((await call('POST', `${base}/uploads/${pending['id'] as string}/withdraw`, lead, { reason: 'Not needed' })).status).toBe(409);
    // Another tenant sees nothing.
    const outsider = await createSyntheticTenant(db.owner, 'Outsider');
    expect((await call('POST', `${base}/uploads/${first['id'] as string}/withdraw`, await token(outsider.subject, outsider), { reason: 'Not mine' })).status).toBe(404);
  });
});
