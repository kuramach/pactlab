import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway, type ModelRequest } from '@pactlab/ai';
import { FIXTURE_ROOMS, MemorySecretStore, type FixtureRoom } from '@pactlab/connectors';
import { loadSyntheticManifest } from '@pactlab/db';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { InMemoryObjectStore } from './testing';
import { SignatureMalwareScanner } from './upload-policy';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';

type Body = Record<string, unknown>;
type SyncFile = { path: string; outcome: string; reason: string | null; documentId: string | null };

/** Classifier answers by a phrase in the file, so tests read like the fixture room. */
const ANSWERS: [string, object][] = [
  ['balance sheet at 30 September', { category: 'BALANCE_SHEET', confidence: 0.97 }],
  ['MASTER SERVICES AGREEMENT', { category: 'CUSTOMER_CONTRACT', confidence: 0.96, counterparty: { name: 'Northgate Logistics (synthetic)', quote: 'Northgate Logistics (synthetic) ("Customer")' } }],
  ['Cash flow statement', { category: 'CASH_FLOW_STATEMENT', confidence: 0.95 }],
  ['Fjord Analytics', { category: 'CUSTOMER_CONTRACT', confidence: 0.95, counterparty: { name: 'Fjord Analytics (synthetic)', quote: 'Fjord Analytics (synthetic) ("Customer")' } }],
];

describe('document sources, requests and customer gaps (T-098)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  const tokens: Record<string, string> = {};
  const secrets = new MemorySecretStore();
  // A copy the tests change, to simulate a new version and a deletion at the source.
  const rooms: Record<string, FixtureRoom> = { 'brightwave-saas': structuredClone(FIXTURE_ROOMS['brightwave-saas'] as FixtureRoom) };
  const drive: Record<string, string> = {};
  let sourceId = '';

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

  async function call(who: string, method: 'GET' | 'POST' | 'PUT', path: string, payload?: Body, headers: Record<string, string> = {}) {
    const response = await app.inject({
      method,
      url: `/v1/deals/${a.dealId}${path}`,
      headers: { authorization: `Bearer ${tokens[who] ?? ''}`, ...headers },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() as Body };
  }

  const classify = (id: string) => call('lead', 'POST', `/documents/${id}/classification`);

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const transport = new ScriptedModelTransport((request: ModelRequest) => {
      const prompt = request.messages[0]?.content ?? '';
      const answer = ANSWERS.find(([phrase]) => prompt.includes(phrase))?.[1] ?? { category: 'OTHER', confidence: 0.9 };
      return JSON.stringify({ reason: 'Read from the first page.', alternatives: [], entity: null, counterparty: null, question: null, ...answer });
    });
    // A Google Drive folder with one file, behind a fake HTTP client.
    const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
      if (init?.headers?.['authorization'] !== 'Bearer drive-token-123') return new Response('{}', { status: 401 });
      if (url.includes('alt=media')) return new Response(drive['f1'] ?? '', { status: 200 });
      return new Response(JSON.stringify({ files: [{ id: 'f1', name: 'Cash flow FY26.md', mimeType: 'text/markdown', size: '40', version: '2' }] }), { status: 200 });
    };
    drive['f1'] = 'Cash flow statement FY26 (synthetic)\nOperating: 610,000';
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      documents: {
        objectStore: new InMemoryObjectStore(),
        malwareScanner: new SignatureMalwareScanner(),
        gateway: new TransportClaudeGateway({ transport, registry: defaultPromptRegistry() }),
      },
      providers: { secrets, fetch, fixtureRooms: rooms },
    });
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    for (const role of ['VIEWER', 'TARGET_CONTRIBUTOR'] as const) {
      const member = await addSyntheticDealMember(db.owner, a, role);
      tokens[role.toLowerCase()] = await token(member.subject, a.auth0OrganizationId);
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  describe('a connected data room', () => {
    it('offers the synthetic rooms where fixture connections are allowed', async () => {
      const listed = await call('lead', 'GET', '/document-sources');
      expect(listed.body['fixtureRooms']).toContainEqual({ id: 'brightwave-saas', label: expect.stringContaining('Brightwave') });
      expect(listed.body['items']).toEqual([]);
    });

    it('reads every file in, through the normal upload path, and shows the duplicate once', async () => {
      const connected = await call('lead', 'POST', '/document-sources', { provider: 'google-drive', mode: 'FIXTURE', displayName: 'Brightwave data room', folder: 'brightwave-saas' });
      expect(connected.status).toBe(201);
      sourceId = connected.body['id'] as string;
      const sync = await call('lead', 'POST', `/document-sources/${sourceId}/sync`);
      expect(sync.status).toBe(200);
      const files = sync.body['files'] as SyncFile[];
      expect(files).toHaveLength(10);
      expect(files.find((file) => file.path === '03 Commercial/Customers/Northgate MSA (signed copy).md')?.outcome).toBe('DUPLICATE');
      expect(sync.body['summary']).toMatchObject({ NEW: 9, DUPLICATE: 1, UNCHANGED: 0 });
      const listed = await call('lead', 'GET', '/documents');
      const sheet = (listed.body['items'] as { fileName: string; intake: Body; source: Body }[]).find((document) => document.fileName === 'BS 30-09-2026.md');
      expect(sheet?.intake['sourcePath']).toBe('04 Legal');
      expect(sheet?.source).toMatchObject({ sourceId, version: '1', state: 'CURRENT' });
    });

    it('reads nothing again when nothing changed', async () => {
      const sync = await call('lead', 'POST', `/document-sources/${sourceId}/sync`);
      expect(sync.body['summary']).toMatchObject({ NEW: 0, UPDATED: 0, UNCHANGED: 9, DUPLICATE: 1, REMOVED: 0 });
    });

    it('reads a new version, and marks a file removed at the source without deleting it', async () => {
      const room = rooms['brightwave-saas'] as { files: FixtureRoom['files'] };
      const files = room.files.map((file) =>
        file.name === 'Mgmt accounts FY26.md' ? { ...file, version: 2, text: `${file.text}\nRestated: operating profit USD 498,000` } : file,
      );
      (room as { files: FixtureRoom['files'] }).files = files.filter((file) => file.name !== 'Cert of Inc - Brightwave.md');
      const sync = await call('lead', 'POST', `/document-sources/${sourceId}/sync`);
      expect(sync.body['summary']).toMatchObject({ UPDATED: 1, REMOVED: 1 });
      expect((sync.body['files'] as SyncFile[]).find((file) => file.outcome === 'REMOVED')?.path).toBe('01 Corporate/Cert of Inc - Brightwave.md');
      const listed = (await call('lead', 'GET', '/documents')).body['items'] as { fileName: string; source: { state: string } | null }[];
      const states = listed.filter((document) => document.fileName === 'Mgmt accounts FY26.md').map((document) => document.source?.state).sort();
      expect(states).toEqual(['CURRENT', 'REPLACED']);
      expect(listed.find((document) => document.fileName === 'Cert of Inc - Brightwave.md')?.source?.state).toBe('REMOVED');
      const intake = await call('lead', 'GET', '/intake');
      expect(intake.body['removedAtSource']).toEqual([expect.objectContaining({ fileName: 'Cert of Inc - Brightwave.md' })]);
    });

    it('reads a live Google Drive folder with a stored token that is never returned', async () => {
      const connected = await call('lead', 'POST', '/document-sources', {
        provider: 'google-drive',
        mode: 'LIVE',
        displayName: 'Seller drive',
        folder: 'folder-123',
        token: 'drive-token-123',
      });
      expect(connected.status).toBe(201);
      const sync = await call('lead', 'POST', `/document-sources/${connected.body['id'] as string}/sync`);
      expect(sync.body['files']).toEqual([{ path: 'Cash flow FY26.md', outcome: 'NEW', reason: null, documentId: expect.any(String) }]);
      const listed = await call('lead', 'GET', '/document-sources');
      expect(JSON.stringify(listed.body)).not.toContain('drive-token-123');
      // Neither the audit trail nor the stored source holds the token: only a secret reference.
      const leaked = (await db.owner.query(
        `SELECT (SELECT count(*)::int FROM audit_events e WHERE e::text LIKE '%drive-token%') + (SELECT count(*)::int FROM document_sources s WHERE s::text LIKE '%drive-token%') AS n`,
      )) as { rows: { n: number }[] };
      expect(leaked.rows[0]?.n).toBe(0);
      const stored = (await db.owner.query(`SELECT credential_ref FROM document_sources WHERE id = $1`, [connected.body['id']])) as { rows: { credential_ref: string }[] };
      expect(stored.rows[0]?.credential_ref).toMatch(/^secretref:pactlab\//);
      expect(await secrets.get(stored.rows[0]?.credential_ref ?? '')).toBe('drive-token-123');
    });

    it('refuses what it cannot do, and keeps sources to the buyer team', async () => {
      expect((await call('lead', 'POST', '/document-sources', { provider: 'vdr', mode: 'LIVE', displayName: 'VDR', folder: 'room', token: 'x'.repeat(20) })).body).toMatchObject({ code: 'SOURCE_NOT_CONFIGURED' });
      expect((await call('lead', 'POST', '/document-sources', { provider: 'onedrive', mode: 'LIVE', displayName: 'OD', folder: 'd/i' })).body).toMatchObject({ code: 'SOURCE_ACCESS' });
      expect((await call('lead', 'POST', '/document-sources', { provider: 'google-drive', mode: 'FIXTURE', displayName: 'x', folder: 'no-such-room' })).body).toMatchObject({ code: 'SOURCE_NOT_FOUND' });
      expect((await call('viewer', 'GET', '/document-sources')).status).toBe(403);
      expect((await call('target_contributor', 'POST', `/document-sources/${sourceId}/sync`)).status).toBe(403);
    });
  });

  describe('re-filing', () => {
    it('remembers the old category and counts what was built from the file', async () => {
      const listed = (await call('lead', 'GET', '/documents')).body['items'] as { id: string; fileName: string }[];
      const sheet = listed.find((document) => document.fileName === 'BS 30-09-2026.md')?.id as string;
      await classify(sheet);
      const refiled = await call('lead', 'PUT', `/documents/${sheet}/category`, { category: 'OTHER' });
      expect(refiled.body).toMatchObject({ category: 'OTHER', recategorizedFrom: 'BALANCE_SHEET', recheck: { draftFindings: 0, acceptedFindings: 0, balanceSheetItems: 0 } });
      await call('lead', 'PUT', `/documents/${sheet}/category`, { category: 'BALANCE_SHEET' });
    });
  });

  describe('requests to the seller', () => {
    let requestId = '';

    it('the buyer asks for missing inputs; the seller sees the request', async () => {
      const created = await call('lead', 'POST', '/document-requests', { items: ['CASH_FLOW_STATEMENT', 'LEASE'], note: 'For the FY26 close.' });
      expect(created.status).toBe(201);
      requestId = created.body['id'] as string;
      const seen = await call('target_contributor', 'GET', '/document-requests');
      expect(seen.status).toBe(200);
      expect(seen.body['items']).toEqual([
        expect.objectContaining({
          id: requestId,
          status: 'OPEN',
          note: 'For the FY26 close.',
          items: [
            { id: 'CASH_FLOW_STATEMENT', label: 'Cash flow statement', received: false, documentIds: [] },
            { id: 'LEASE', label: 'Lease', received: false, documentIds: [] },
          ],
        }),
      ]);
    });

    it('ticks an item off once the seller’s upload is filed under it', async () => {
      const uploaded = await call('target_contributor', 'POST', '/documents', {
        fileName: 'Cash flow FY26 - seller.md',
        contentType: 'text/markdown',
        contentBase64: Buffer.from('Cash flow statement for FY26, seller copy (synthetic)\nOperating: 610,000\nInvesting: -85,000').toString('base64'),
      });
      expect(uploaded.status).toBe(201);
      await classify(uploaded.body['id'] as string);
      const seen = await call('target_contributor', 'GET', '/document-requests');
      const items = (seen.body['items'] as { items: { id: string; received: boolean }[] }[])[0]?.items;
      expect(items?.find((item) => item.id === 'CASH_FLOW_STATEMENT')?.received).toBe(true);
      expect(items?.find((item) => item.id === 'LEASE')?.received).toBe(false);
      // The seller sees what their file was filed as, but not the AI's reasoning.
      const mine = (await call('target_contributor', 'GET', '/documents')).body['items'] as { intake: Body }[];
      expect(mine[0]?.intake).toMatchObject({ state: 'FILED', category: 'CASH_FLOW_STATEMENT', reason: null, confidence: null });
    });

    it('only the buyer side asks, with categories the pact expects, and closes requests', async () => {
      expect((await call('target_contributor', 'POST', '/document-requests', { items: ['LEASE'] })).status).toBe(403);
      expect((await call('lead', 'POST', '/document-requests', { items: ['MULTIFAMILY_RENT_ROLL'] })).status).toBe(422);
      expect((await call('lead', 'POST', `/document-requests/${requestId}/close`)).body).toEqual({ id: requestId, status: 'CLOSED' });
      expect((await call('lead', 'POST', `/document-requests/${requestId}/close`)).status).toBe(404);
    });
  });

  describe('customer contract gaps', () => {
    it('names the top customers by billed revenue that have no contract filed', async () => {
      const manifest = await loadSyntheticManifest('HealthyCo');
      const connection = await call('lead', 'POST', '/connections', {
        provider: 'csv',
        displayName: 'HealthyCo billing export',
        mode: 'FIXTURE',
        config: { datasets: manifest.datasets.map((dataset) => dataset.dataset) },
      });
      const sync = await call('lead', 'POST', '/sync-runs', { connectionId: connection.body['id'] }, { 'idempotency-key': `gaps-${newId()}` });
      expect(sync.status).toBeLessThan(300);
      const contract = await call('lead', 'POST', '/documents', {
        fileName: 'Fjord MSA.md',
        contentType: 'text/markdown',
        contentBase64: Buffer.from('MASTER SUBSCRIPTION AGREEMENT between Brightwave Software Inc. and Fjord Analytics (synthetic) ("Customer").').toString('base64'),
      });
      await classify(contract.body['id'] as string);
      const intake = await call('lead', 'GET', '/intake');
      const contracts = (intake.body['checklist'] as { id: string; state: string; missingFor: string[] }[]).find((item) => item.id === 'CUSTOMER_CONTRACT');
      // Northgate's contract is in from the data room; Fjord's was just uploaded; HealthyCo's other billed customers have none.
      expect(contracts?.state).toBe('PARTIAL');
      expect(contracts?.missingFor.slice(0, 3)).toEqual(['Birchwood Clinics (synthetic)', 'Aurora Logistics (synthetic)', 'Delta Orchard (synthetic)']);
      expect(contracts?.missingFor).not.toContain('Fjord Analytics (synthetic)');
      expect(intake.body['request']).toContain('- Customer contract: Birchwood Clinics (synthetic), Aurora Logistics (synthetic)');
    });
  });
});
