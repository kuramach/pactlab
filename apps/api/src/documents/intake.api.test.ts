import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  defaultPromptRegistry,
  ModelProviderError,
  ScriptedModelTransport,
  TransportClaudeGateway,
  type ModelRequest,
} from '@pactlab/ai';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { strToU8, zipSync } from 'fflate';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { InMemoryObjectStore } from './testing';
import { SignatureMalwareScanner } from './upload-policy';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

type Body = Record<string, unknown>;

const MSA =
  'MASTER SUBSCRIPTION AGREEMENT\nThis Agreement is made between Brightwave Inc. ("Provider") and Acme Logistics LLC ("Customer").';
const STATEMENT = 'FY2025 statement\nRevenue 4,200,000\nOperating cash flow 900,000';
const BALANCE_SHEET = 'Balance sheet at 31 December 2025\nCash 1,200,000\nTerm loan 3,000,000';
const ORG_CHART = 'Org chart\nJane Doe — CFO\nJohn Roe — VP Sales';

/** The classifier's scripted answer for each file, keyed by a phrase in its first page. */
const ANSWERS: Record<string, object> = {
  'MASTER SUBSCRIPTION AGREEMENT': {
    category: 'CUSTOMER_CONTRACT',
    confidence: 0.96,
    reason: 'Titled Master Subscription Agreement; Acme Logistics is the Customer.',
    alternatives: [],
    entity: 'Brightwave Inc.',
    counterparty: { name: 'Acme Logistics LLC', quote: 'Acme Logistics LLC ("Customer")' },
    question: null,
  },
  'FY2025 statement': {
    category: 'INCOME_STATEMENT',
    confidence: 0.6,
    reason: 'Revenue and cash flow lines in one short statement.',
    alternatives: [{ category: 'CASH_FLOW_STATEMENT', confidence: 0.5 }],
    entity: null,
    counterparty: null,
    question: null,
  },
  'Balance sheet at': {
    category: 'BALANCE_SHEET',
    confidence: 0.97,
    reason: 'Titled balance sheet; cash and a term loan at a date.',
    alternatives: [],
    entity: 'Brightwave Inc.',
    counterparty: null,
    question: null,
  },
  'Org chart': {
    category: 'PEOPLE_RECORD',
    confidence: 0.95,
    reason: 'Names with job titles.',
    alternatives: [],
    entity: null,
    counterparty: null,
    question: null,
  },
};

describe('document intake API (T-098)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let transport: ScriptedModelTransport;
  let respond: (request: ModelRequest) => string;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

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
      url: `/v1/deals/${a.dealId}${path}`,
      headers: { authorization: `Bearer ${tokens[who] ?? ''}` },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() as Body };
  }

  const zipBase64 = (files: Record<string, string>) =>
    Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])))).toString('base64');

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const identityVerifier = new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) });
    transport = new ScriptedModelTransport((request) => respond(request));
    const gateway = new TransportClaudeGateway({ transport, registry: defaultPromptRegistry() });
    app = await createApp({
      prisma: db.prisma,
      identityVerifier,
      logger: createLogger('api-test', { level: 'silent' }),
      documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner(), gateway },
    });
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    tokens['other'] = await token(b.subject, b.auth0OrganizationId);
    for (const role of ['VIEWER', 'TARGET_CONTRIBUTOR'] as const) {
      const member = await addSyntheticDealMember(db.owner, a, role);
      tokens[role.toLowerCase()] = await token(member.subject, a.auth0OrganizationId);
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  beforeEach(() => {
    respond = (request) => {
      const prompt = request.messages[0]?.content ?? '';
      const match = Object.entries(ANSWERS).find(([phrase]) => prompt.includes(phrase));
      if (!match) throw new Error('no scripted classification');
      return JSON.stringify(match[1]);
    };
  });

  describe('zip upload', () => {
    it('uploads every file in the archive and says what happened to each', async () => {
      const response = await call('lead', 'POST', '/document-archives', {
        fileName: 'Brightwave data room.zip',
        contentBase64: zipBase64({
          'Commercial/Customers/Acme MSA.txt': MSA,
          'Finance/FY2025.txt': STATEMENT,
          'Finance/Balance sheet.csv': BALANCE_SHEET.replaceAll('\n', '\r\n'),
          'HR/Org chart.txt': ORG_CHART,
          'Finance/Copy of FY2025.txt': STATEMENT,
          'Board deck.pptx': 'slides',
          'Infected.txt': EICAR,
          '__MACOSX/._Acme MSA.txt': 'x',
        }),
      });
      expect(response.status).toBe(201);
      const files = response.body['files'] as { path: string; outcome: string; reason: string | null; document: Body | null }[];
      const outcome = Object.fromEntries(files.map((file) => [file.path, [file.outcome, file.reason]]));
      expect(outcome).toEqual({
        'Board deck.pptx': ['SKIPPED', 'UNSUPPORTED_TYPE'],
        'Commercial/Customers/Acme MSA.txt': ['UPLOADED', null],
        'Finance/Balance sheet.csv': ['UPLOADED', null],
        // Files go in path order: the copy arrives first, so the original is the duplicate.
        'Finance/Copy of FY2025.txt': ['UPLOADED', null],
        'Finance/FY2025.txt': ['DUPLICATE', null],
        'HR/Org chart.txt': ['UPLOADED', null],
        'Infected.txt': ['REJECTED', 'UNREADABLE_OR_INFECTED'],
      });
      for (const file of files) {
        if (file.document) ids[file.path.split('/').pop() ?? ''] = file.document['id'] as string;
      }
      const msa = files.find((file) => file.path.endsWith('Acme MSA.txt'))?.document;
      expect(msa?.['intake']).toMatchObject({ state: 'UNCLASSIFIED', sourcePath: 'Commercial/Customers' });
    });

    it('refuses something that is not a zip', async () => {
      const response = await call('lead', 'POST', '/document-archives', { fileName: 'x.zip', contentBase64: Buffer.from('nope').toString('base64') });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ code: 'ARCHIVE_NOT_A_ZIP' });
    });

    it('lets only uploaders send archives', async () => {
      const response = await call('viewer', 'POST', '/document-archives', { fileName: 'x.zip', contentBase64: zipBase64({ 'a.txt': 'a' }) });
      expect(response.status).toBe(403);
    });
  });

  describe('classification', () => {
    it('files a clear contract on its own, tagged to its customer, with the folder as a hint', async () => {
      const response = await call('lead', 'POST', `/documents/${ids['Acme MSA.txt']}/classification`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        state: 'FILED',
        category: 'CUSTOMER_CONTRACT',
        source: 'AI',
        confidence: 0.96,
        counterpartyName: 'Acme Logistics LLC',
        label: 'Customer contract',
        route: { kind: 'EXTRACT' },
        question: null,
      });
      expect(transport.requests.at(-1)?.messages[0]?.content).toContain('Folder: Commercial/Customers');
      const run = (await db.owner.query(`SELECT task_type FROM ai_runs WHERE id = $1`, [response.body['classifiedRunId']])) as { rows: { task_type: string }[] };
      expect(run.rows[0]?.task_type).toBe('document.classification');
    });

    it('asks a person when it cannot tell two categories apart', async () => {
      const response = await call('lead', 'POST', `/documents/${ids['FY2025.txt']}/classification`);
      expect(response.body).toMatchObject({
        state: 'NEEDS_YOU',
        category: 'INCOME_STATEMENT',
        question: 'Is this an income statement (P&L) or a cash flow statement?',
        route: null,
      });
    });

    it('excludes named people data from AI once filed as such', async () => {
      const response = await call('lead', 'POST', `/documents/${ids['Org chart.txt']}/classification`);
      expect(response.body).toMatchObject({ state: 'FILED', category: 'PEOPLE_RECORD' });
      const extraction = await call('lead', 'POST', `/documents/${ids['Org chart.txt']}/extractions`);
      expect(extraction.status).toBe(422);
      await expect(db.owner.query(`UPDATE documents SET ai_excluded = false WHERE id = $1`, [ids['Org chart.txt']])).rejects.toThrow(/cannot be lifted/);
    });

    it('never sends an AI-excluded file to the model; it waits for a person', async () => {
      const uploaded = await call('lead', 'POST', '/documents', {
        fileName: 'Private.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from(BALANCE_SHEET + ' (private)').toString('base64'),
        aiExcluded: true,
      });
      const calls = transport.requests.length;
      const response = await call('lead', 'POST', `/documents/${uploaded.body['id'] as string}/classification`);
      expect(response.body).toMatchObject({ state: 'NOT_READ', category: null });
      expect(transport.requests.length).toBe(calls);
      ids['Private.txt'] = uploaded.body['id'] as string;
    });

    it('leaves the file as it was when the model is unavailable', async () => {
      respond = () => {
        throw new ModelProviderError('THROTTLED', null);
      };
      const response = await call('lead', 'POST', `/documents/${ids['Balance sheet.csv']}/classification`);
      expect(response.status).toBe(503);
      const listed = await call('lead', 'GET', '/documents');
      const sheet = (listed.body['items'] as { id: string; intake: Body }[]).find((d) => d.id === ids['Balance sheet.csv']);
      expect(sheet?.intake['state']).toBe('UNCLASSIFIED');
    });

    it('is buyer-side work: viewers and other tenants cannot classify', async () => {
      expect((await call('viewer', 'POST', `/documents/${ids['Balance sheet.csv']}/classification`)).status).toBe(403);
      expect((await call('other', 'POST', `/documents/${ids['Balance sheet.csv']}/classification`)).status).toBe(404);
    });
  });

  describe('a person answers', () => {
    it('files the document under the person’s answer, which a later AI run never overwrites', async () => {
      const answered = await call('lead', 'PUT', `/documents/${ids['FY2025.txt']}/category`, { category: 'INCOME_STATEMENT' });
      expect(answered.status).toBe(200);
      expect(answered.body).toMatchObject({ state: 'FILED', category: 'INCOME_STATEMENT', source: 'PERSON', question: null });
      const again = await call('lead', 'POST', `/documents/${ids['FY2025.txt']}/classification`);
      expect(again.body).toMatchObject({ source: 'PERSON', category: 'INCOME_STATEMENT' });
    });

    it('refuses a category the pact does not offer', async () => {
      const response = await call('lead', 'PUT', `/documents/${ids['Balance sheet.csv']}/category`, { category: 'MULTIFAMILY_RENT_ROLL' });
      expect(response.status).toBe(422);
    });
  });

  describe('checklist', () => {
    it('shows received, connected and missing inputs, and what is waiting for a person', async () => {
      await call('lead', 'PUT', `/documents/${ids['Balance sheet.csv']}/category`, { category: 'BALANCE_SHEET' });
      await db.owner.query(
        `INSERT INTO connections (id, organization_id, deal_id, provider, display_name, mode, config, created_by, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'github', 'GitHub', 'FIXTURE', '{}', $3, now())`,
        [a.organizationId, a.dealId, a.userId],
      );
      const response = await call('lead', 'GET', '/intake');
      expect(response.status).toBe(200);
      const checklist = Object.fromEntries(
        (response.body['checklist'] as { id: string; state: string }[]).map((item) => [item.id, item.state]),
      );
      expect(checklist).toMatchObject({
        BALANCE_SHEET: 'RECEIVED',
        INCOME_STATEMENT: 'RECEIVED',
        CUSTOMER_CONTRACT: 'RECEIVED',
        BILLING_INVOICE_LINE: 'MISSING',
        CODE_AND_DELIVERY: 'CONNECTED',
      });
      expect(response.body['request']).toContain('Please share:\n- Invoice lines');
      expect((response.body['needsYou'] as Body[]).map((item) => item['fileName'])).toEqual(['Private.txt']);
      expect(response.body['categories']).toContainEqual({ id: 'BALANCE_SHEET', label: 'Balance sheet', route: 'BALANCE_SHEET' });
    });

    it('is buyer analysis: a target contributor cannot read it', async () => {
      expect((await call('target_contributor', 'GET', '/intake')).status).toBe(403);
    });
  });
});
