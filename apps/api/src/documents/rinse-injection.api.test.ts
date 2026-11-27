import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { RINSED_FIXTURE_MANIFEST, RINSED_FIXTURE_ROOM, type FixtureRoom } from '@pactlab/connectors';
import { zipSync } from 'fflate';
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

describe('injecting a folder finished in Pactlab Rinse (T-178, T-178d)', () => {
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

    const claims = (await call('lead', 'GET', '/claims')).body['items'] as { id: string; statement: string; source: string; status: string; origin: string }[];
    const claim = claims.find((entry) => entry.id === claimId);
    // Its own origin, not MANUAL with a labelled source (T-178d).
    expect(claim?.origin).toBe('HAND_SOURCED');
    expect(claim?.source).toBe('Hand-sourced — entered by Dana Whitlow, Harbour Lane Apartments LLC (synthetic) on 2026-11-20 (Pactlab Rinse; not documentary evidence)');
    expect(claim?.statement).toContain('Occupied units: 106');
    expect(claim?.status).toBe('UNVERIFIED');
    // The claims register is buyer-side analysis: the seller who prepared the set never sees it.
    expect((await call('seller', 'GET', '/claims')).status).toBe(403);

    const documents = (await call('lead', 'GET', '/documents')).body['items'] as { id: string; fileName: string; intake: Body }[];
    const income = documents.find((document) => document.fileName === 'Income statement FY2026.md');
    expect(income?.intake).toMatchObject({ state: 'FILED', category: 'INCOME_STATEMENT' });
    // Provenance is its own record now, not intake-reason text (T-178d).
    expect(String(income?.intake['reason'])).not.toContain('SHA-256');
    const provenance = await call('lead', 'GET', `/document-provenance?documentId=${income?.id ?? ''}`);
    expect(provenance.status, JSON.stringify(provenance.body)).toBe(200);
    const record = (provenance.body['items'] as Body[])[0];
    expect(record).toMatchObject({
      role: 'CONVERTED',
      canonical: { path: 'rinsed/Financials/Income statement FY2026.md' },
      original: { path: 'Financials/Income statement FY2026.md', sha256: RINSED_FIXTURE_MANIFEST.documents[0]?.original?.sha256 },
      set: { name: RINSED_FIXTURE_MANIFEST.set.name, origin: 'SYNC', preparedBy: { name: 'Dana Whitlow' } },
      entry: { route: 'CONVERT', audit: { figuresCompared: expect.any(Number) } },
    });
    expect((record?.['entry'] as { conversionLog: unknown[] }).conversionLog.length).toBeGreaterThan(0);
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

  it('stores the set’s gap notes and source discrepancies, and drafts each discrepancy as a cited finding for a person to decide', async () => {
    const sets = await call('lead', 'GET', '/rinse-sets');
    expect(sets.status, JSON.stringify(sets.body)).toBe(200);
    const set = (sets.body['items'] as Body[])[0] as { gaps: { state: string; note: string | null }[]; sourceDiscrepancies: { label: string; findingId: string | null; documentId: string | null }[] };
    expect(sets.body['total']).toBe(1);
    expect(set.gaps.find((gap) => gap.state === 'NOTED')?.note).toContain('delinquency report');
    const discrepancy = set.sourceDiscrepancies[0];
    expect(discrepancy).toMatchObject({ label: 'Total current assets', documentId: expect.any(String) });
    expect(discrepancy?.findingId).toBeTruthy();
    const finding = await call('lead', 'GET', `/findings/${discrepancy?.findingId ?? ''}`);
    expect(finding.body['finding']).toMatchObject({ status: 'DRAFT', domain: 'FINANCIAL', direction: 0 });
    const evidence = (finding.body['finding'] as { evidence: { documentCitation: { quote: string } | null }[] }).evidence;
    expect(evidence[0]?.documentCitation?.quote).toContain('Total current assets');
    // The deal team's own source is buyer-only, so its set is too.
    expect(((await call('seller', 'GET', '/rinse-sets')).body['items'] as unknown[]).length).toBe(0);
  });

  const zip = (room: FixtureRoom, prefix = '') =>
    Buffer.from(zipSync(Object.fromEntries(room.files.map((file) => [`${prefix}${file.folder ? `${file.folder}/` : ''}${file.name}`, new TextEncoder().encode(file.text)])))).toString('base64');

  it('imports a rinsed folder once as a zip, through the same manifest reader and checks (path b)', async () => {
    const fresh = await call('lead', 'POST', '/v1/pacts', {
      name: 'Project Harbour Lane II',
      baseCurrency: 'USD',
      buyer: { name: 'Rinse Capital', ownership: 'PRIVATE' },
      seller: { name: 'Harbour Lane Apartments LLC (synthetic)', ownership: 'PRIVATE', companyType: 'MULTIFAMILY' },
    });
    const otherDeal = fresh.body['id'] as string;
    const seller = await addSyntheticDealMember(db.owner, { ...a, dealId: otherDeal }, 'TARGET_CONTRIBUTOR');
    tokens['seller2'] = await token(seller.subject, a.auth0OrganizationId);
    const path = (p: string) => `/v1/deals/${otherDeal}${p}`;
    const room = structuredClone(RINSED_FIXTURE_ROOM) as FixtureRoom;

    // No manifest, no import: an ordinary zip goes through zip intake instead.
    const bare = await call('seller2', 'POST', path('/rinse-archives'), { fileName: 'set.zip', contentBase64: zip({ ...room, files: room.files.slice(1) }) });
    expect(bare).toMatchObject({ status: 422, body: { code: 'RINSE_MANIFEST_MISSING' } });

    // The seller uploads it, wrapped in its own folder as a zipped folder is; it comes in shared.
    const tampered = { ...room, files: [...room.files.map((file) => (file.folder === 'rinsed/Leases' ? { ...file, text: `${file.text}\nAmended later.` } : file)), { folder: 'Extras', name: 'Late addition.md', text: 'Added after.', version: 1 }] };
    const imported = await call('seller2', 'POST', path('/rinse-archives'), { fileName: 'Harbour Lane.zip', contentBase64: zip(tampered, 'Harbour Lane/') });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    const files = imported.body['files'] as SyncFile[];
    const outcome = (p: string) => files.find((file) => file.path === p);
    expect(outcome('pactlab-manifest.json')).toMatchObject({ outcome: 'SKIPPED', reason: 'RINSE_MANIFEST' });
    expect(outcome('rinsed/Financials/Income statement FY2026.md')?.outcome).toBe('NEW');
    expect(outcome('Financials/Income statement FY2026.md')).toMatchObject({ outcome: 'SKIPPED', reason: 'RINSE_ORIGINAL' });
    expect(outcome('hand-sourced/Vacancy and occupancy schedule.md')).toMatchObject({ outcome: 'SKIPPED', reason: 'HAND_SOURCED_CLAIM' });
    expect(outcome('rinsed/Leases/Retail unit lease.md')).toMatchObject({ outcome: 'REJECTED', reason: 'CHANGED_SINCE_RINSE' });
    expect(outcome('Extras/Late addition.md')).toMatchObject({ outcome: 'REJECTED', reason: 'NOT_IN_RINSE_MANIFEST' });
    // A seller's import leaves the hand entry for the deal team, and drafts nothing.
    expect(imported.body['rinse']).toMatchObject({ status: 'READ', claimsWaitForDealTeam: true });

    const sellerSets = (await call('seller2', 'GET', path('/rinse-sets'))).body['items'] as Body[];
    expect(sellerSets).toHaveLength(1);
    expect(sellerSets[0]).toMatchObject({ origin: 'ARCHIVE' });
    const incomeId = outcome('rinsed/Financials/Income statement FY2026.md')?.documentId ?? '';
    const sellerView = await call('seller2', 'GET', path(`/document-provenance?documentId=${incomeId}`));
    expect((sellerView.body['items'] as Body[])[0]).toMatchObject({ set: { origin: 'ARCHIVE' }, original: { path: 'Financials/Income statement FY2026.md' } });

    // The deal team imports the same set: the set is recorded once, the claim and the draft follow.
    const again = await call('lead', 'POST', path('/rinse-archives'), { fileName: 'Harbour Lane.zip', contentBase64: zip(tampered, 'Harbour Lane/'), shared: true });
    expect(again.status).toBe(201);
    expect(again.body['rinse']).toMatchObject({ claimsWaitForDealTeam: false });
    const sets = (await call('lead', 'GET', path('/rinse-sets'))).body as { total: number; items: { sourceDiscrepancies: { findingId: string | null }[] }[] };
    expect(sets.total).toBe(1);
    expect(sets.items[0]?.sourceDiscrepancies[0]?.findingId).toBeTruthy();
    const claims = (await call('lead', 'GET', path('/claims'))).body['items'] as { origin: string }[];
    expect(claims.filter((claim) => claim.origin === 'HAND_SOURCED')).toHaveLength(1);
  });
});
