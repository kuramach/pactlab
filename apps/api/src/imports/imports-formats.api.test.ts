import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { syntheticXlsx } from '@pactlab/connectors/xlsx-fixture';
import { BACKGROUND_IMPORT_ROWS, runUploadImport, type ImportProgress, type UploadImportJob } from '@pactlab/db';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { FileSystemObjectStore } from '../documents/storage-adapters';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import type { ImportQueue } from './upload-store';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

const HEADER = ['line_id', 'invoice_id', 'customer_id', 'currency', 'amount', 'interval', 'period_start', 'period_end', 'invoice_status', 'created'];
const line = (index: number) => [`il_${index}`, `in_${index}`, `cus-${index % 40}`, 'USD', '120.00', 'month', '2026-09-01', '2026-10-01', 'paid', '2026-09-01'];
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Stands in for the worker: runs queued imports in-process, keeping progress the way the BullMQ job does. */
class InProcessQueue implements ImportQueue {
  readonly progressByRun = new Map<string, ImportProgress>();
  private readonly pending: Promise<unknown>[] = [];
  readonly jobs: UploadImportJob[] = [];

  constructor(private readonly run: (job: UploadImportJob, onProgress: (progress: ImportProgress) => Promise<void>) => Promise<unknown>) {}

  async enqueue(job: UploadImportJob, rows: number): Promise<void> {
    this.jobs.push(job);
    this.progressByRun.set(job.syncRunId, { phase: 'QUEUED', processed: 0, total: rows });
  }

  /** Run everything queued, as the worker would. */
  async drain(): Promise<void> {
    for (const job of this.jobs.splice(0)) {
      this.pending.push(this.run(job, async (progress) => void this.progressByRun.set(job.syncRunId, progress)));
    }
    await Promise.all(this.pending);
  }

  async progress(run: { syncRunId: string }): Promise<ImportProgress | null> {
    return this.progressByRun.get(run.syncRunId) ?? null;
  }
}

describe('import formats and background imports through the API', { timeout: 180_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let storeDir: string;
  let alpha: SyntheticTenant;
  let outsider: SyntheticTenant;
  let signingKey: CryptoKey;
  let queue: InProcessQueue;
  let outage = false;

  const token = (tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(tenant.subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey);

  async function call(method: 'GET' | 'POST', url: string, bearer: string, payload?: Body) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  async function upload(bearer: string, content: string | Uint8Array, fileName: string, contentType = 'application/octet-stream', system = 'pactlab_standard') {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/deals/${alpha.dealId}/uploads?system=${system}&fileName=${encodeURIComponent(fileName)}`,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': contentType },
      payload: typeof content === 'string' ? content : Buffer.from(content),
    });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    alpha = await createSyntheticTenant(db.owner, 'Alpha');
    outsider = await createSyntheticTenant(db.owner, 'Bravo');
    storeDir = await mkdtemp(join(tmpdir(), 'pactlab-formats-'));
    const store = new FileSystemObjectStore(storeDir);
    // The worker's view of the store; a test can make it fail once, like an outage.
    const workerStore = { get: (key: string) => (outage ? ((outage = false), Promise.reject(new Error('store down'))) : store.get(key)), put: store.put.bind(store), delete: store.delete.bind(store) };
    queue = new InProcessQueue((job, onProgress) => runUploadImport(db.prisma, workerStore, job, { onProgress }));
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      uploads: { objectStore: store, malwareScanner: new SignatureMalwareScanner(), importQueue: queue },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
    if (storeDir) await rm(storeDir, { recursive: true, force: true });
  });

  it('imports an Excel workbook: first sheet with data by default, another sheet on request', async () => {
    const lead = await token(alpha);
    const workbook = syntheticXlsx([
      { name: 'Cover', rows: [] },
      {
        name: 'Invoice lines',
        rows: [HEADER, ['x_1', 'in_x1', 'cus-1', 'USD', 99.5, 'month', { date: '2026-09-01' }, { date: '2026-10-01' }, 'paid', { date: '2026-09-01' }]],
      },
      { name: 'Credits', rows: [HEADER, ['x_2', 'in_x2', 'cus-1', 'USD', -10, 'month', { date: '2026-09-01' }, { date: '2026-10-01' }, 'paid', { date: '2026-09-01' }]] },
    ]);
    const uploaded = await upload(lead, workbook, 'billing.xlsx', XLSX_TYPE);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({ format: 'XLSX', encoding: null, delimiter: null, sheet: 'Invoice lines', sheets: ['Invoice lines', 'Credits'], rowCount: 1 });
    expect(uploaded.body['sample']).toEqual([['x_1', 'in_x1', 'cus-1', 'USD', '99.5', 'month', '2026-09-01', '2026-10-01', 'paid', '2026-09-01']]);
    const base = `/v1/deals/${alpha.dealId}/uploads/${uploaded.body['id'] as string}`;

    const credits = await call('POST', `${base}/sheet`, lead, { sheet: 'Credits' });
    expect(credits).toMatchObject({ status: 200, body: { sheet: 'Credits', rowCount: 1 } });
    expect((await call('POST', `${base}/sheet`, lead, { sheet: 'Missing' })).body).toMatchObject({ code: 'SHEET_NOT_FOUND' });
    const back = await call('POST', `${base}/sheet`, lead, { sheet: 'Invoice lines' });
    const mapping = back.body['suggestedMapping'] as Body;
    expect(mapping['dateFormat']).toBe('YYYY-MM-DD');

    const imported = await call('POST', `${base}/import`, lead, { mapping });
    expect(imported.body).toMatchObject({ background: false, syncRun: { status: 'SUCCEEDED', recordsCreated: 1 } });
    // Once imported, the sheet is fixed.
    expect((await call('POST', `${base}/sheet`, lead, { sheet: 'Credits' })).status).toBe(409);
  });

  it('reads semicolon exports with comma decimals, Windows-1252 text and tab-separated files', async () => {
    const lead = await token(alpha);
    const semicolon = `${HEADER.join(';')}\nsc_1;in_s1;cus-1;EUR;"1.234,50";month;2026-09-01;2026-10-01;paid;2026-09-01\n`;
    // An unknown system: the separator suggests the number format (verified layouts keep their own).
    const read = await upload(lead, semicolon, 'sap-export.csv', 'text/csv', 'other');
    expect(read.body).toMatchObject({ format: 'CSV', delimiter: ';', encoding: 'UTF-8' });
    expect((read.body['suggestedMapping'] as Body)['numberFormat']).toBe('COMMA_DECIMAL');

    const latin = Buffer.concat([Buffer.from(`${HEADER.join(',')}\n`), Buffer.from('w_1,in_w1,Caf'), Buffer.from([0xe9]), Buffer.from(',USD,1.00,month,2026-09-01,2026-10-01,paid,2026-09-01\n')]);
    const windows = await upload(lead, latin, 'legacy.csv');
    expect(windows.body).toMatchObject({ encoding: 'WINDOWS-1252' });
    expect((windows.body['sample'] as string[][])[0]?.[2]).toBe('Café');

    const tsv = await upload(lead, `${HEADER.join('\t')}\n${line(1).join('\t')}\n`, 'lines.tsv', 'text/tab-separated-values');
    expect(tsv.body).toMatchObject({ format: 'TSV', delimiter: '\t', rowCount: 1 });
  });

  it('refuses legacy and macro-enabled Excel files with a reason', async () => {
    const lead = await token(alpha);
    expect((await upload(lead, new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'old.xls')).body).toMatchObject({ status: 415, code: 'LEGACY_EXCEL' });
    const macros = syntheticXlsx([{ name: 'S', rows: [HEADER, line(1)] }], { 'xl/vbaProject.bin': 'synthetic' });
    expect((await upload(lead, macros, 'book.xlsx', XLSX_TYPE)).body).toMatchObject({ status: 415, code: 'MACROS' });
  });

  it('imports a large file in the background with progress; replays are instant; other tenants see nothing', async () => {
    const lead = await token(alpha);
    const rows = BACKGROUND_IMPORT_ROWS + 1;
    const csv = [HEADER.join(','), ...Array.from({ length: rows }, (_, index) => line(index).join(','))].join('\n') + '\n';
    const uploaded = await upload(lead, csv, 'large.csv', 'text/csv');
    expect(uploaded.body).toMatchObject({ rowCount: rows });
    const base = `/v1/deals/${alpha.dealId}/uploads/${uploaded.body['id'] as string}`;
    const mapping = uploaded.body['suggestedMapping'] as Body;

    const started = await call('POST', `${base}/import`, lead, { mapping });
    expect(started.body).toMatchObject({ background: true, replayed: false, syncRun: { status: 'QUEUED' } });
    const runId = (started.body['syncRun'] as Body)['id'] as string;
    const progressUrl = `/v1/deals/${alpha.dealId}/import-runs/${runId}`;
    expect((await call('GET', progressUrl, lead)).body).toMatchObject({ status: 'QUEUED', phase: 'QUEUED', processed: 0, total: rows });
    // A double click enqueues nothing new: the run is the same.
    expect((await call('POST', `${base}/import`, lead, { mapping })).body).toMatchObject({ syncRun: { id: runId } });

    await queue.drain();
    const done = await call('GET', progressUrl, lead);
    expect(done.body).toMatchObject({ status: 'SUCCEEDED', phase: 'DONE', processed: rows, total: rows, recordsCreated: rows, errorClass: null });
    expect(queue.progressByRun.get(runId)).toEqual({ phase: 'DONE', processed: rows, total: rows });
    expect((await call('GET', base, lead)).body).toMatchObject({ status: 'IMPORTED' });

    const replay = await call('POST', `${base}/import`, lead, { mapping });
    expect(replay.body).toMatchObject({ replayed: true, background: false, syncRun: { status: 'SUCCEEDED' } });
    const evidence = await db.owner.query(`SELECT count(*)::int AS n FROM evidence_items WHERE deal_id = $1 AND source_record_id LIKE 'il\\_%'`, [alpha.dealId]);
    expect(evidence.rows).toEqual([{ n: rows }]);

    const stranger = await token(outsider);
    expect((await call('GET', progressUrl, stranger)).status).toBe(404);
    expect((await call('GET', `/v1/deals/${outsider.dealId}/import-runs/${runId}`, stranger)).status).toBe(404);
  });

  it('a background import that fails (store outage) is reported, and importing again retries it', async () => {
    const lead = await token(alpha);
    const rows = BACKGROUND_IMPORT_ROWS + 1;
    const csv = [HEADER.join(','), ...Array.from({ length: rows }, (_, index) => line(100_000 + index).join(','))].join('\n') + '\n';
    const uploaded = await upload(lead, csv, 'outage.csv', 'text/csv');
    const base = `/v1/deals/${alpha.dealId}/uploads/${uploaded.body['id'] as string}`;
    const mapping = uploaded.body['suggestedMapping'] as Body;

    outage = true;
    const first = await call('POST', `${base}/import`, lead, { mapping });
    const runId = (first.body['syncRun'] as Body)['id'] as string;
    await queue.drain();
    const failed = await call('GET', `/v1/deals/${alpha.dealId}/import-runs/${runId}`, lead);
    expect(failed.body).toMatchObject({ status: 'FAILED', phase: 'DONE', errorClass: 'UploadImportError:STORE_UNAVAILABLE' });
    expect((await call('GET', base, lead)).body).toMatchObject({ status: 'UPLOADED' });

    const retry = await call('POST', `${base}/import`, lead, { mapping });
    expect(retry.body).toMatchObject({ background: true, syncRun: { id: runId } });
    await queue.drain();
    expect((await call('GET', `/v1/deals/${alpha.dealId}/import-runs/${runId}`, lead)).body).toMatchObject({ status: 'SUCCEEDED', recordsCreated: rows });
  });
});
