import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway, type ModelRequest } from '@pactlab/ai';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { importMapFixtureResponse } from '../demo-seed/import-map-fixture';
import { FileSystemObjectStore } from '../documents/storage-adapters';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
type Body = Record<string, unknown>;

/** A synthetic P&L the way a seller sends it: title rows, months across, subtotals. */
const PNL = [
  'Northwind Software LLC (synthetic),,,',
  'Income statement,,,',
  ',Jan 2026,Feb 2026,Mar 2026',
  'Subscription revenue,100000,110000,120000',
  'Services revenue,20000,20000,25000',
  'Total revenue,120000,130000,145000',
  'Hosting,15000,16000,17000',
  'Gross profit,105000,114000,128000',
  'Salaries and wages,60000,60000,61000',
  'Net income,45000,54000,67000',
].join('\n');

/**
 * The mapping assistant answers through the real gateway, from a script: the fixture's rule-based
 * proposal by default, or whatever a test sets (`reply`). Every request is kept, so a test can check
 * what the model was shown.
 */
const seen: ModelRequest[] = [];
let reply: ((request: ModelRequest) => string) | null = null;
const transport = new ScriptedModelTransport((request) => {
  seen.push(request);
  return reply ? reply(request) : importMapFixtureResponse(request.messages[0]?.content ?? '');
});

describe('the mapping assistant through the API (Kumar, 2026-11-21)', { timeout: 180_000 }, () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let off: NestFastifyApplication;
  let storeDir: string;
  let alpha: SyntheticTenant;
  let signingKey: CryptoKey;

  const token = (subject: string, tenant: SyntheticTenant) =>
    new SignJWT({ org_id: tenant.auth0OrganizationId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey);

  async function call(target: NestFastifyApplication, method: 'GET' | 'POST', url: string, bearer: string, payload?: Body) {
    const response = await target.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  async function upload(target: NestFastifyApplication, bearer: string, content: string, fileName = 'pnl.csv', as = 'FINANCIAL_PNL', instructions?: string) {
    const response = await target.inject({
      method: 'POST',
      url: `/v1/deals/${alpha.dealId}/uploads?target=${as}&system=pactlab_standard&fileName=${encodeURIComponent(fileName)}${instructions === undefined ? '' : `&instructions=${encodeURIComponent(instructions)}`}`,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'text/csv' },
      payload: content,
    });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    alpha = await createSyntheticTenant(db.owner, 'Alpha');
    storeDir = await mkdtemp(join(tmpdir(), 'pactlab-assist-'));
    const store = new FileSystemObjectStore(storeDir);
    const pair = await generateKeyPair('RS256');
    signingKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const base = {
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      uploads: { objectStore: store, malwareScanner: new SignatureMalwareScanner() },
    };
    app = await createApp({ ...base, documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner(), gateway: new TransportClaudeGateway({ transport, registry: defaultPromptRegistry() }) } });
    off = await createApp(base);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await off?.close();
    await db?.stop();
    if (storeDir) await rm(storeDir, { recursive: true, force: true });
  });

  it('a P&L with title rows and months across: the header, layout and line kinds are proposed, subtotals tie out, lines import', async () => {
    reply = null;
    const lead = await token(alpha.subject, alpha);
    const uploaded = await upload(app, lead, PNL);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({ headerRow: 3, header: ['Column A', 'Jan 2026', 'Feb 2026', 'Mar 2026'], rowCount: 7 });
    const mapping = uploaded.body['suggestedMapping'] as Body;
    expect(mapping['layout']).toEqual({ kind: 'PERIOD_COLUMNS', periods: [{ column: 'Jan 2026', period: '2026-01' }, { column: 'Feb 2026', period: '2026-02' }, { column: 'Mar 2026', period: '2026-03' }] });
    expect(mapping['lineKinds']).toMatchObject({ 'Subscription revenue': 'REVENUE', 'Total revenue': 'TOTAL_REVENUE', Hosting: 'COGS', 'Net income': 'NET_INCOME' });
    expect(uploaded.body['assist']).toMatchObject({ source: 'AI', note: null, questions: [] });
    // How it read the file, said back before anything is mapped: its words, and row groups checked against the grid.
    const reading = (uploaded.body['assist'] as { reading: { summary: string; rowGroups: { from: number; to: number; kind: string }[] } }).reading;
    expect(reading.summary).toContain('row 3');
    expect(reading.rowGroups.slice(0, 2)).toEqual([expect.objectContaining({ from: 1, to: 2, kind: 'TITLE' }), expect.objectContaining({ from: 3, to: 3, kind: 'HEADER' })]);
    expect(reading.rowGroups.some((group) => group.kind === 'SUBTOTAL')).toBe(true);
    expect(reading.rowGroups.every((group) => group.to <= (uploaded.body['preview'] as unknown[]).length)).toBe(true);

    // The model saw the grid as cells, never asked for a value; its run is on record.
    expect(seen.at(-1)?.messages[0]?.content).toContain('Row 3: B=Jan 2026 | C=Feb 2026 | D=Mar 2026');
    const runs = await db.owner.query<{ status: string }>(`SELECT status FROM ai_runs WHERE deal_id = $1 AND prompt_id = 'import.map'`, [alpha.dealId]);
    expect(runs.rows).toEqual([{ status: 'SUCCEEDED' }]);

    const base = `/v1/deals/${alpha.dealId}/uploads/${uploaded.body['id'] as string}`;
    const preview = await call(app, 'POST', `${base}/preview`, lead, { mapping });
    expect(preview.body).toMatchObject({ problems: [], validRows: 12, tieOut: [] });
    const imported = await call(app, 'POST', `${base}/import`, lead, { mapping });
    expect(imported.body).toMatchObject({ syncRun: { status: 'SUCCEEDED', recordsCreated: 12 } });
    const lines = await db.owner.query(`SELECT 1 FROM evidence_items WHERE deal_id = $1 AND evidence_type = 'finance.pnl_line'`, [alpha.dealId]);
    expect(lines.rows).toHaveLength(12);

    // What it picked up: the records, the month-by-month totals from the lines alone (never the file's subtotals).
    const results = await call(app, 'GET', `${base}/results`, lead);
    expect(results.status).toBe(200);
    expect(results.body).toMatchObject({ status: 'IMPORTED', activeRecords: 12, run: { recordsCreated: 12 }, findings: 0 });
    const sample = results.body['sample'] as { fields: { name: string }[]; rows: (string | null)[][] };
    expect(sample.fields.map((field) => field.name)).toEqual(['account', 'month', 'amount']);
    expect(sample.rows).toHaveLength(10);
    expect((results.body['pnlMonths'] as Body[])[0]).toEqual({ month: '2026-01', revenue: '120000', costOfRevenue: '15000', grossProfit: '105000', operatingExpenses: '60000', operatingIncome: '45000', netIncome: '45000' });
    expect(results.body['pnlMonths']).toHaveLength(3);
  });

  it('a subtotal that does not add up blocks the import until the line kinds are fixed or the gap accepted', async () => {
    reply = null;
    const lead = await token(alpha.subject, alpha);
    const wrong = PNL.replace('Total revenue,120000,130000,145000', 'Total revenue,120000,135000,145000').replace('Northwind', 'Northwind Two');
    const uploaded = await upload(app, lead, wrong, 'pnl-two.csv');
    const base = `/v1/deals/${alpha.dealId}/uploads/${uploaded.body['id'] as string}`;
    const mapping = uploaded.body['suggestedMapping'] as Body;
    const preview = await call(app, 'POST', `${base}/preview`, lead, { mapping });
    expect(preview.body['tieOut']).toEqual([{ account: 'Total revenue', month: '2026-02', kind: 'TOTAL_REVENUE', stated: '135000', computed: '130000' }]);
    expect(preview.body['problems']).toEqual(['A subtotal does not add up to its lines: check the line kinds, or accept the gaps']);
    expect((await call(app, 'POST', `${base}/import`, lead, { mapping })).status).toBe(422);
    const accepted = await call(app, 'POST', `${base}/import`, lead, { mapping: { ...mapping, acceptTieOutGaps: true } });
    expect(accepted.body).toMatchObject({ syncRun: { status: 'SUCCEEDED' } });
  });

  it('an unsure pick is left empty with the assistant’s question; import is refused until a person maps it', async () => {
    // The assistant is unsure which column holds the accounts.
    reply = (request) => {
      const proposal = JSON.parse(importMapFixtureResponse(request.messages[0]?.content ?? '')) as { fields: { field: string; confidence: number }[]; questions: unknown[] };
      for (const field of proposal.fields) if (field.field === 'account') field.confidence = 0.4;
      proposal.questions = [{ field: 'account', question: 'Which column names the P&L lines?', options: ['Column A'] }];
      return JSON.stringify(proposal);
    };
    const lead = await token(alpha.subject, alpha);
    const uploaded = await upload(app, lead, PNL.replace('Northwind', 'Northwind Three'), 'pnl-three.csv');
    expect(uploaded.body['assist']).toMatchObject({ questions: [{ field: 'account', question: 'Which column names the P&L lines?', options: ['Column A'] }] });
    const mapping = uploaded.body['suggestedMapping'] as { fields: Body };
    expect(mapping.fields['account']).toEqual({ kind: 'none' });
    const base = `/v1/deals/${alpha.dealId}/uploads/${uploaded.body['id'] as string}`;
    expect((await call(app, 'POST', `${base}/preview`, lead, { mapping })).body['problems']).toContain('Account is required');
    expect((await call(app, 'POST', `${base}/import`, lead, { mapping })).status).toBe(422);
    const answered = { ...mapping, fields: { ...mapping.fields, account: { kind: 'column', column: 'Column A' } } };
    expect((await call(app, 'POST', `${base}/import`, lead, { mapping: answered })).body).toMatchObject({ syncRun: { status: 'SUCCEEDED' } });
    reply = null;
  });

  it('a model answer naming columns the file does not have is dropped, never trusted', async () => {
    reply = () =>
      JSON.stringify({
        summary: 'A P&L with a ledger line column.',
        rowGroups: [{ from: 3, to: 3, kind: 'HEADER', note: '' }, { from: 40, to: 50, kind: 'DATA', note: 'not in the grid' }],
        headerRow: 3,
        layout: { kind: 'PERIOD_COLUMNS', periods: [{ column: 'Apr 2026', period: '2026-04' }] },
        fields: [{ field: 'account', column: 'Ledger line', confidence: 0.99, reason: 'Header "Ledger line"', evidence: 'Ledger line' }],
        lineKinds: [],
        questions: [],
      });
    const lead = await token(alpha.subject, alpha);
    const uploaded = await upload(app, lead, PNL.replace('Northwind', 'Northwind Four'), 'pnl-four.csv');
    const mapping = uploaded.body['suggestedMapping'] as { fields: Body; layout?: unknown };
    expect(mapping.layout).toBeUndefined();
    expect(mapping.fields['account']).toEqual({ kind: 'none' });
    expect((uploaded.body['assist'] as { reading: unknown }).reading).toEqual({ summary: 'A P&L with a ledger line column.', rowGroups: [{ from: 3, to: 3, kind: 'HEADER', note: '' }] });
    reply = null;
  });

  it('with the assistant off: the header is still found, months across read from the header, and the screen says so', async () => {
    const lead = await token(alpha.subject, alpha);
    const uploaded = await upload(off, lead, PNL.replace('Northwind', 'Northwind Five'), 'pnl-five.csv');
    expect(uploaded.body).toMatchObject({ headerRow: 3, assist: { source: 'NAMES', note: 'Columns were matched by name only: the mapping assistant is off.' } });
    const mapping = uploaded.body['suggestedMapping'] as Body;
    expect(mapping['layout']).toMatchObject({ kind: 'PERIOD_COLUMNS' });
    expect(mapping['fields']).toMatchObject({ account: { kind: 'column', column: 'Column A' } });
    // Line kinds are a person's to set.
    const preview = await call(off, 'POST', `/v1/deals/${alpha.dealId}/uploads/${uploaded.body['id'] as string}/preview`, lead, { mapping });
    expect((preview.body['problems'] as string[])[0]).toMatch(/^Say what these lines are: "Subscription revenue"/);
  });

  it('a seller’s upload is assisted too, its run recorded for the pact (ai_runs are buyer-side under RLS)', async () => {
    reply = null;
    const contributor = await addSyntheticDealMember(db.owner, alpha, 'TARGET_CONTRIBUTOR');
    const uploaded = await upload(app, await token(contributor.subject, alpha), PNL.replace('Northwind', 'Northwind Seller'), 'pnl-seller.csv');
    expect(uploaded.body).toMatchObject({ status: 'UPLOADED', visibility: 'SHARED', assist: { source: 'AI' } });
    const runs = await db.owner.query<{ requested_by: string }>(`SELECT requested_by FROM ai_runs WHERE deal_id = $1 AND prompt_id = 'import.map' AND requested_by = $2`, [alpha.dealId, contributor.userId]);
    expect(runs.rows).toHaveLength(1);
  });

  it('a spreadsheet already in the documents imports from there, with no second upload; one kept from AI is mapped by name only', async () => {
    reply = null;
    const lead = await token(alpha.subject, alpha);
    const file = async (fileName: string, text: string, aiExcluded = false) =>
      (await call(app, 'POST', `/v1/deals/${alpha.dealId}/documents`, lead, { fileName, contentType: 'text/csv', contentBase64: Buffer.from(text).toString('base64'), ...(aiExcluded ? { aiExcluded } : {}) })).body['id'] as string;
    const filed = await file('P&L FY2026.csv', PNL.replace('Northwind', 'Northwind Filed'));
    const imported = await call(app, 'POST', `/v1/deals/${alpha.dealId}/documents/${filed}/import`, lead, { target: 'FINANCIAL_PNL' });
    expect(imported).toMatchObject({ status: 201, body: { fileName: 'P_L FY2026.csv', target: 'FINANCIAL_PNL', headerRow: 3, assist: { source: 'AI' } } });

    const before = seen.length;
    const privateFile = await file('Private P&L.csv', PNL.replace('Northwind', 'Northwind Private'), true);
    const kept = await call(app, 'POST', `/v1/deals/${alpha.dealId}/documents/${privateFile}/import`, lead, { target: 'FINANCIAL_PNL' });
    expect(kept.body).toMatchObject({ assist: { source: 'NAMES', note: 'Columns were matched by name only: this file is kept away from AI.' } });
    expect(seen.length).toBe(before);
    expect((await call(app, 'POST', `/v1/deals/${alpha.dealId}/documents/${privateFile}/import`, lead, { target: 'NOT_A_TARGET' })).status).toBe(400);
  });

  it('a standard file needs no assistant', async () => {
    const before = seen.length;
    const lead = await token(alpha.subject, alpha);
    const uploaded = await upload(app, lead, 'line_id,invoice_id,customer_id,currency,amount,interval,period_start,period_end,invoice_status,created\nil_1,in_1,cus-1,USD,10.00,month,2026-09-01,2026-10-01,paid,2026-09-01\n', 'billing.csv', 'BILLING_INVOICE_LINE');
    expect(uploaded.body).toMatchObject({ headerRow: 1, assist: { source: 'NAMES', note: null } });
    expect(seen.length).toBe(before);
  });

  it('a person can move the header row; the assistant reads again', async () => {
    reply = null;
    const lead = await token(alpha.subject, alpha);
    const uploaded = await upload(app, lead, PNL.replace('Northwind', 'Northwind Six'), 'pnl-six.csv');
    const base = `/v1/deals/${alpha.dealId}/uploads/${uploaded.body['id'] as string}`;
    const moved = await call(app, 'POST', `${base}/sheet`, lead, { headerRow: 2 });
    expect(moved.body).toMatchObject({ headerRow: 2, header: ['Income statement', 'Column B', 'Column C', 'Column D'] });
    const back = await call(app, 'POST', `${base}/sheet`, lead, { headerRow: 3 });
    expect(back.body).toMatchObject({ headerRow: 3, rowCount: 7 });
    expect((await call(app, 'POST', `${base}/sheet`, lead, { sheet: 'Sheet 2' })).status).toBe(409);
  });

  describe('import prompting (T-152)', () => {
    /** A full-width title row looks like a header; only the person knows it is not. */
    const TITLED = ['Northwind Software LLC,Annual,Report,Draft', ...PNL.split('\n').slice(1)].join('\n');

    it('instructions reach the mapping job, change the outcome, are quoted back and marked as guided', async () => {
      reply = null;
      const lead = await token(alpha.subject, alpha);
      const plain = await upload(app, lead, TITLED.replace('Northwind', 'Guided One'), 'guided-one.csv');
      expect(plain.body).toMatchObject({ headerRow: 1, guidance: null });

      const before = seen.length;
      const told = 'rows 1: title row, skip it';
      const guided = await upload(app, lead, TITLED.replace('Northwind', 'Guided Two'), 'guided-two.csv', 'FINANCIAL_PNL', told);
      expect(guided.body).toMatchObject({ headerRow: 3, guidance: { instructions: told, annotations: [] } });
      expect(seen.length).toBe(before + 1);
    });

    it('row annotations go to the mapper as numbered rows, steer the header and mark fields guided', async () => {
      reply = null;
      const lead = await token(alpha.subject, alpha);
      const uploaded = await upload(app, lead, TITLED.replace('Northwind', 'Guided Three'), 'guided-three.csv');
      const base = `/v1/deals/${alpha.dealId}/uploads/${uploaded.body['id'] as string}`;
      const guidance = { instructions: 'Amounts are annual. column A is the account', annotations: [{ fromRow: 1, toRow: 2, note: 'title rows, skip them' }] };
      const saved = await call(app, 'POST', `${base}/sheet`, lead, { guidance });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ headerRow: 3, guidance, assist: { source: 'AI', guidance } });
      const prompt = seen.at(-1)?.messages[0]?.content ?? '';
      expect(prompt).toContain('About the file: Amounts are annual. column A is the account');
      expect(prompt).toContain('rows 1–2: title rows, skip them');
      expect((saved.body['assist'] as { picks: Record<string, { by: string }> }).picks['account']?.by).toBe('GUIDED');
      expect((saved.body['assist'] as { picks: Record<string, { by: string }> }).picks['month']?.by).toBe('AI');

      // It is stored with the import and shown again by the detail view.
      expect((await call(app, 'GET', base, lead)).body).toMatchObject({ guidance });
      // Clearing it reads the file without it.
      const cleared = await call(app, 'POST', `${base}/sheet`, lead, { guidance: { instructions: '', annotations: [] } });
      expect(cleared.body).toMatchObject({ guidance: null });
      const audit = await db.owner.query(`SELECT 1 FROM audit_events WHERE deal_id = $1 AND action = 'source_upload.guidance_set' AND target_id = $2`, [alpha.dealId, uploaded.body['id']]);
      expect(audit.rows).toHaveLength(2);
    });

    it('an annotation calling a data row a subtotal asks a question; the import is never silently changed', async () => {
      reply = null;
      const lead = await token(alpha.subject, alpha);
      const uploaded = await upload(app, lead, PNL.replace('Northwind', 'Guided Four'), 'guided-four.csv');
      const base = `/v1/deals/${alpha.dealId}/uploads/${uploaded.body['id'] as string}`;
      // Row 5 is "Services revenue": it does not add up the row above it.
      const wrong = await call(app, 'POST', `${base}/sheet`, lead, { guidance: { instructions: '', annotations: [{ fromRow: 5, toRow: 5, note: 'row 5 is a subtotal, not data' }] } });
      const questions = (wrong.body['assist'] as { questions: { field: string | null; question: string }[] }).questions;
      expect(questions.find((question) => question.field === null)?.question).toContain('row 5');
      // The right row ties out and raises nothing; the values read are the same either way.
      const right = await call(app, 'POST', `${base}/sheet`, lead, { guidance: { instructions: '', annotations: [{ fromRow: 6, toRow: 6, note: 'subtotal' }] } });
      expect((right.body['assist'] as { questions: unknown[] }).questions).toEqual([]);
      expect(right.body['suggestedMapping']).toEqual(wrong.body['suggestedMapping']);
    });

    it('guidance round-trips when the same file is uploaded again, and can be replaced', async () => {
      reply = null;
      const lead = await token(alpha.subject, alpha);
      const file = TITLED.replace('Northwind', 'Guided Five');
      const first = await upload(app, lead, file, 'guided-five.csv', 'FINANCIAL_PNL', 'rows 1: title row, skip it');
      expect(first.body).toMatchObject({ headerRow: 3 });
      const again = await upload(app, lead, file, 'guided-five.csv');
      expect(again.body).toMatchObject({ headerRow: 3, guidance: { instructions: 'rows 1: title row, skip it' } });
      const replaced = await upload(app, lead, file, 'guided-five.csv', 'FINANCIAL_PNL', 'Amounts are monthly');
      expect(replaced.body).toMatchObject({ headerRow: 1, guidance: { instructions: 'Amounts are monthly' } });
    });

    it('with the assistant off, guidance is kept and shown, and the screen says it was not used', async () => {
      const lead = await token(alpha.subject, alpha);
      const uploaded = await upload(off, lead, PNL.replace('Northwind', 'Guided Six'), 'guided-six.csv', 'FINANCIAL_PNL', 'Amounts are annual');
      expect(uploaded.body).toMatchObject({ guidance: { instructions: 'Amounts are annual' }, assist: { source: 'NAMES' } });
      expect((uploaded.body['assist'] as { note: string }).note).toContain('Your instructions were not used.');
    });

    it('too-long guidance is refused', async () => {
      const lead = await token(alpha.subject, alpha);
      const uploaded = await upload(app, lead, PNL.replace('Northwind', 'Guided Seven'), 'guided-seven.csv');
      const base = `/v1/deals/${alpha.dealId}/uploads/${uploaded.body['id'] as string}`;
      expect((await call(app, 'POST', `${base}/sheet`, lead, { guidance: { instructions: 'x'.repeat(1001), annotations: [] } })).status).toBe(400);
      expect((await upload(app, lead, PNL, 'long.csv', 'FINANCIAL_PNL', 'x'.repeat(1001))).status).toBe(400);
    });
  });
});
