import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { RINSED_FIXTURE_MANIFEST, RINSED_FIXTURE_ROOM, type FixtureRoom } from '@pactlab/connectors';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
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

describe('injecting a folder finished in Pactlab Rinse (T-178)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  let dealId = '';
  const tokens: Record<string, string> = {};
  const rooms: Record<string, FixtureRoom> = { [RINSED_FIXTURE_ROOM.id]: structuredClone(RINSED_FIXTURE_ROOM) as FixtureRoom };

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);

  async function call(who: string, method: 'GET' | 'POST', path: string, payload?: Body) {
    const response = await app.inject({ method, url: path.startsWith('/v1') ? path : `/v1/deals/${dealId}${path}`, headers: { authorization: `Bearer ${tokens[who] ?? ''}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.json() as Body };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Rinse');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    // No classification is asked of the model: the manifest brings the seller's.
    const transport = new ScriptedModelTransport(() => {
      throw new Error('No model call is expected');
    });
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner(), gateway: new TransportClaudeGateway({ transport, registry: defaultPromptRegistry() }) },
      providers: { fixtureRooms: rooms },
    });
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    const pact = await call('lead', 'POST', '/v1/pacts', {
      name: 'Project Harbour Lane',
      baseCurrency: 'USD',
      buyer: { name: 'Rinse Capital', ownership: 'PRIVATE' },
      seller: { name: 'Harbour Lane Apartments LLC (synthetic)', ownership: 'PRIVATE', companyType: 'MULTIFAMILY' },
    });
    expect(pact.status, JSON.stringify(pact.body)).toBe(201);
    dealId = pact.body['id'] as string;
    const seller = await addSyntheticDealMember(db.owner, { ...a, dealId }, 'TARGET_CONTRIBUTOR');
    tokens['seller'] = await token(seller.subject, a.auth0OrganizationId);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  let sourceId = '';

  it('the finished folder is connected and synced: the canonical copies come in, the originals and hand entries do not', async () => {
    // Fixture sources are connected by the deal team; a seller connects their own drive with their own sign-in.
    const connected = await call('lead', 'POST', '/document-sources', { provider: 'onedrive', mode: 'FIXTURE', displayName: 'Harbour Lane — rinsed', folder: RINSED_FIXTURE_ROOM.id });
    expect(connected.status, JSON.stringify(connected.body)).toBe(201);
    sourceId = connected.body['id'] as string;
    const sync = await call('lead', 'POST', `/document-sources/${sourceId}/sync`);
    expect(sync.status, JSON.stringify(sync.body)).toBe(200);
    const files = sync.body['files'] as SyncFile[];
    const outcome = (path: string) => files.find((file) => file.path === path);
    expect(outcome('pactlab-manifest.json')).toMatchObject({ outcome: 'SKIPPED', reason: 'RINSE_MANIFEST' });
    // The canonical copy is read; the original stays at the source, named in its provenance.
    expect(outcome('rinsed/Financials/Income statement FY2026.md')?.outcome).toBe('NEW');
    expect(outcome('Financials/Income statement FY2026.md')).toMatchObject({ outcome: 'SKIPPED', reason: 'RINSE_ORIGINAL' });
    // Spreadsheets travel as they are, for guided import.
    expect(outcome('Rent roll/Rent roll Sept 2026.csv')?.outcome).toBe('NEW');
    // A hand-sourced entry is never a document a finding could cite.
    expect(outcome('hand-sourced/Vacancy and occupancy schedule.md')).toMatchObject({ outcome: 'SKIPPED', reason: 'HAND_SOURCED_CLAIM' });
    expect(sync.body['rinse']).toMatchObject({ status: 'READ', claimsWaitForDealTeam: false, documents: 6, audited: 3 });
    lastSync = sync.body;
  });

  let lastSync: Body = {};

  it('files documents with the seller’s classifications and records the hand-sourced entry as a labelled claim, once', async () => {
    const sync = { body: lastSync };
    const rinse = sync.body['rinse'] as Body;
    expect(rinse['set']).toMatchObject({ name: RINSED_FIXTURE_MANIFEST.set.name, pack: 'MULTIFAMILY', preparedBy: 'Dana Whitlow, Harbour Lane Apartments LLC (synthetic)' });
    expect(rinse['notedGaps']).toEqual(
      expect.arrayContaining([expect.objectContaining({ state: 'NOTED', note: expect.stringContaining('delinquency report') }), expect.objectContaining({ state: 'NOT_APPLICABLE' })]),
    );
    expect(rinse['sourceDiscrepancies']).toEqual([expect.objectContaining({ label: 'Total current assets', stated: '468000', computed: '458000' })]);
    const claimId = (rinse['handSourced'] as { claimId: string | null }[])[0]?.claimId;
    expect(claimId).toBeTruthy();

    const claims = (await call('lead', 'GET', '/claims')).body['items'] as { id: string; statement: string; source: string; status: string }[];
    const claim = claims.find((entry) => entry.id === claimId);
    expect(claim?.source).toBe('Hand-sourced — entered by Dana Whitlow, Harbour Lane Apartments LLC (synthetic) on 2026-11-20 (Pactlab Rinse; not documentary evidence)');
    expect(claim?.statement).toContain('Occupied units: 106');
    expect(claim?.status).toBe('UNVERIFIED');
    // The claims register is buyer-side analysis: the seller who prepared the set never sees it.
    expect((await call('seller', 'GET', '/claims')).status).toBe(403);

    const documents = (await call('lead', 'GET', '/documents')).body['items'] as { fileName: string; intake: Body }[];
    const income = documents.find((document) => document.fileName === 'Income statement FY2026.md');
    expect(income?.intake).toMatchObject({ state: 'FILED', category: 'INCOME_STATEMENT' });
    expect(String(income?.intake['reason'])).toContain('Financials/Income statement FY2026.md');
    expect(documents.find((document) => document.fileName === 'Rent roll Sept 2026.csv')?.intake).toMatchObject({ state: 'FILED', category: 'MULTIFAMILY_RENT_ROLL' });
    expect(documents.some((document) => document.fileName === 'Vacancy and occupancy schedule.md')).toBe(false);

    const again = await call('lead', 'POST', `/document-sources/${sourceId}/sync`);
    expect((again.body['rinse'] as { handSourced: { claimId: string }[] }).handSourced[0]?.claimId).toBe(claimId);
    const after = (await call('lead', 'GET', '/claims')).body['items'] as unknown[];
    expect(after).toHaveLength(claims.length);
  });

  it('files a document left unsorted by an earlier sync (a seller’s) on the deal team’s next sync, never one a person filed', async () => {
    await db.owner.query(`UPDATE documents SET intake_state = 'UNCLASSIFIED', category = NULL, category_source = NULL WHERE deal_id = $1 AND file_name = 'Balance sheet Sept 2026.md'`, [dealId]);
    const sync = await call('lead', 'POST', `/document-sources/${sourceId}/sync`);
    expect(sync.status).toBe(200);
    const documents = (await call('lead', 'GET', '/documents')).body['items'] as { fileName: string; intake: Body }[];
    expect(documents.find((document) => document.fileName === 'Balance sheet Sept 2026.md')?.intake).toMatchObject({ state: 'FILED', category: 'BALANCE_SHEET' });
  });

  it('refuses a file changed after the rinse, and a file the manifest does not name', async () => {
    const room = rooms[RINSED_FIXTURE_ROOM.id] as { files: FixtureRoom['files'] };
    room.files = [
      ...room.files.map((file) => (file.folder === 'rinsed/Leases' ? { ...file, version: 2, text: `${file.text}\nAmended later.` } : file)),
      { folder: 'Extras', name: 'Late addition.md', text: 'Added after the rinse.', version: 1 },
    ];
    const sync = await call('lead', 'POST', `/document-sources/${sourceId}/sync`);
    const files = sync.body['files'] as SyncFile[];
    expect(files.find((file) => file.path === 'rinsed/Leases/Retail unit lease.md')).toMatchObject({ outcome: 'REJECTED', reason: 'CHANGED_SINCE_RINSE' });
    expect(files.find((file) => file.path === 'Extras/Late addition.md')).toMatchObject({ outcome: 'REJECTED', reason: 'NOT_IN_RINSE_MANIFEST' });
  });
});
