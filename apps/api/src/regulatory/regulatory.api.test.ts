import 'reflect-metadata';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { FileSystemObjectStore } from '../documents/storage-adapters';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const CASE = resolve(import.meta.dirname, '../../../../demo-data/cases/case-01-grocery');
type Body = Record<string, unknown>;

/**
 * T-091 in the app, on T-092 Case 1 loaded into a real pact through the real
 * import, document and entry APIs: the screen and workbench surface every
 * planted defect, and the results become cited DRAFT findings — including the
 * termination-fee and remedy-cost lines for the bridge.
 */
describe('regulatory & deal certainty on Case 1', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let a: SyntheticTenant;
  let key: CryptoKey;
  const storeDir = mkdtempSync(join(tmpdir(), 'pactlab-reg-'));
  const tokens: Record<string, string> = {};
  const docs: Record<string, string> = {};

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  async function call(who: string, method: 'GET' | 'POST', path: string, payload?: Body) {
    const response = await app.inject({ method, url: `/v1/deals/${a.dealId}${path}`, headers: { authorization: `Bearer ${tokens[who] ?? ''}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.json() as Body };
  }
  async function importCsv(file: string, target: string) {
    const query = new URLSearchParams({ system: 'pactlab_standard', fileName: file, target });
    const uploaded = await app.inject({
      method: 'POST',
      url: `/v1/deals/${a.dealId}/uploads?${query.toString()}`,
      headers: { authorization: `Bearer ${tokens['lead'] ?? ''}`, 'content-type': 'text/csv' },
      payload: readFileSync(join(CASE, file)),
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const upload = uploaded.json() as { id: string; suggestedMapping: Body };
    const imported = await call('lead', 'POST', `/uploads/${upload.id}/import`, { mapping: upload.suggestedMapping });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    expect(imported.body['syncRun']).toMatchObject({ status: 'SUCCEEDED', issuesCount: 0 });
  }
  const cite = (file: string, quote: string) => ({ documentId: docs[file] as string, pageNumber: 1, quote });

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Meridian');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'error' }),
      uploads: { objectStore: new FileSystemObjectStore(storeDir), malwareScanner: new SignatureMalwareScanner() },
      documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner() },
    });
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    const contributor = await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR');
    tokens['contributor'] = await token(contributor.subject, a.auth0OrganizationId);

    await importCsv('sites.csv', 'REGULATORY_FOOTPRINT');
    await importCsv('remedy-package.csv', 'REMEDY_PACKAGE');
    for (const file of ['merger-agreement.md', 'regulator-letter-round-1.md', 'regulator-letter-round-2.md', 'package-revision-notes.md', 'price-pledge-press-release.md', 'remedy-buyer-profile.md']) {
      const uploaded = await call('lead', 'POST', '/documents', { fileName: file, contentType: 'text/markdown', contentBase64: readFileSync(join(CASE, file)).toString('base64') });
      expect(uploaded.status).toBe(201);
      docs[file] = uploaded.body['id'] as string;
    }
    const terms = JSON.parse(readFileSync(join(CASE, 'terms.json'), 'utf8')) as Body;
    const entries: Body[] = [
      { kind: 'TERMS', payload: { signedOn: terms['signedOn'], outsideDate: terms['outsideDate'], effortsStandard: terms['effortsStandard'], divestitureCap: terms['divestitureCap'], currency: 'USD', terminationFees: terms['terminationFees'], ebitdaMultiple: '8' }, citation: cite('merger-agreement.md', 'Meridian shall not be required to divest more than 650 stores') },
      { kind: 'BUYER', payload: JSON.parse(readFileSync(join(CASE, 'buyer.json'), 'utf8')), citation: cite('remedy-buyer-profile.md', 'It operates 23 retail stores today') },
      { kind: 'FEEDBACK', payload: { round: 1, date: '2023-11-02', regulator: 'Federal antitrust agency (synthetic)', criticisms: [{ topic: 'SIZE', substance: 'The 413-site proposal leaves too many overlap markets untouched.' }] }, citation: cite('regulator-letter-round-1.md', 'leaves too many overlap markets untouched') },
      { kind: 'FEEDBACK', payload: { round: 2, date: '2024-02-12', regulator: 'Federal antitrust agency (synthetic)', criticisms: [{ topic: 'COHERENCE', substance: 'The package is a patchwork of banners and stores without the distribution and systems to run them as one business.' }] }, citation: cite('regulator-letter-round-2.md', 'The package is a patchwork of banners and stores') },
      { kind: 'REVISION', payload: { revision: 2, date: '2024-01-18', addresses: ['SIZE'] }, citation: cite('package-revision-notes.md', 'expanded from 413 to 520 sites') },
      { kind: 'REVISION', payload: { revision: 3, date: '2024-04-22', addresses: ['SIZE'] }, citation: cite('package-revision-notes.md', 'expanded to 579 sites') },
      { kind: 'COMMITMENT', payload: { text: 'Meridian will invest $1 billion in lowering prices after closing.', measurement: null, enforcementParty: null, durationMonths: null }, citation: cite('price-pledge-press-release.md', 'Meridian will invest $1 billion in lowering prices') },
    ];
    for (const entry of entries) {
      const added = await call('lead', 'POST', '/regulatory/entries', entry);
      expect(added.status, JSON.stringify(added.body)).toBe(201);
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
    rmSync(storeDir, { recursive: true, force: true });
  });

  it('refuses an entry whose quote is not on the cited page', async () => {
    const bad = await call('lead', 'POST', '/regulatory/entries', {
      kind: 'COMMITMENT',
      payload: { text: 'A pledge that is not in the release.', measurement: null, enforcementParty: null, durationMonths: null },
      citation: cite('price-pledge-press-release.md', 'This sentence is not in the press release.'),
    });
    expect(bad.status).toBe(422);
  });

  it('surfaces every key item of Case 1 and bands the clearance risk', async () => {
    const result = await call('lead', 'GET', '/regulatory');
    expect(result.status).toBe(200);
    const checks = (result.body['findings'] as { check: string; phase: string }[]).map((finding) => `${finding.phase}:${finding.check}`).sort();
    expect(checks).toEqual(
      ['PRE:overlap-pockets', 'PRE:labor-exposure', 'DILIGENCE:unused-headroom', 'DILIGENCE:cherry-pick', 'DILIGENCE:incoherent-package', 'DILIGENCE:buyer-viability', 'DILIGENCE:unaddressed-feedback', 'DILIGENCE:unverifiable-pledge'].sort(),
    );
    expect(result.body).toMatchObject({
      depth: 'FULL',
      inputs: { sites: 4628, packageSites: 579, packageRevision: 3, terms: true, buyer: true, feedbackRounds: 2, revisions: 2, commitments: 1 },
      clearance: { band: 'NO_GO' },
      markets: { overlapping: 100, presumed: 78 },
      certainty: { divestitureCap: 650, feeExposure: { ACQUIRER: '600000000', TARGET: '0' } },
      commitments: [{ grade: 'UNVERIFIABLE' }],
    });
    expect((result.body['authorities'] as { name: string }[]).length).toBeGreaterThan(0);
  });

  it('records the results as cited DRAFT findings, with the bridge lines priced for review', async () => {
    const proposed = await call('lead', 'POST', '/regulatory/findings');
    expect(proposed.status).toBe(200);
    expect(proposed.body).toEqual({ created: 10, existing: 0 });
    // Idempotent.
    expect((await call('lead', 'POST', '/regulatory/findings')).body).toEqual({ created: 0, existing: 10 });
    const listed = (await call('lead', 'GET', '/findings')).body['items'] as { title: string; status: string; domain: string; evidence: unknown[]; pricedRisk: Body | null }[];
    const regulatory = listed.filter((finding) => finding.domain === 'REGULATORY');
    expect(regulatory).toHaveLength(10);
    expect(regulatory.every((finding) => finding.status === 'DRAFT' && finding.evidence.length > 0)).toBe(true);
    expect(regulatory.find((finding) => finding.title === 'Termination fee exposure if clearance fails')?.pricedRisk).toMatchObject({ type: 'REMEDIATION_COST', currency: 'USD', low: '0', high: '600000000' });
    expect(regulatory.find((finding) => finding.title === 'Expected remedy cost: the divested sites')?.pricedRisk).toMatchObject({ type: 'PRICE_REDUCTION', currency: 'USD' });
  });

  it('is buyer-side analysis: a target contributor reads none of it', async () => {
    expect((await call('contributor', 'GET', '/regulatory')).status).toBe(403);
    expect((await call('contributor', 'POST', '/regulatory/findings')).status).toBe(403);
  });
});
