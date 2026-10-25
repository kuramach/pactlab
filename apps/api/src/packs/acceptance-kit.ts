import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { IMPORT_TARGET_DEFINITIONS, PACK_IDS, PACKS, type PackId } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { expect } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { syntheticPdf } from '../documents/synthetic-files';
import { FileSystemObjectStore } from '../documents/storage-adapters';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';

/**
 * Pack acceptance harness (test-only): generates the public demo data
 * (scripts/demo-data/generate.py), starts the real API on a fresh database,
 * creates a pact whose seller is the pack, and loads one `<pack>/<CURRENCY>/`
 * folder through the real import and document APIs — billing, every pack
 * extract (by the target's file name) and every document as a PDF built the
 * way the demo kit builds them.
 */
const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
export type Body = Record<string, unknown>;

export interface AcceptanceDeal {
  readonly app: NestFastifyApplication;
  readonly dealId: string;
  readonly folder: string;
  readonly readme: string;
  call(method: 'GET' | 'POST' | 'PATCH', url: string, who: string, payload?: unknown): Promise<{ status: number; body: Body }>;
  close(): Promise<void>;
}

/** A PDF as the demo kit builds it: pages split on `---page---`, lines wrapped at 92 characters. */
export function pdfOf(markdown: string): Buffer {
  const wrap = (text: string) =>
    text.split('\n').flatMap((paragraph) => {
      const lines: string[] = [];
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (`${line} ${word}`.trim().length > 92) {
          lines.push(line);
          line = word;
        } else line = `${line} ${word}`.trim();
      }
      return [...lines, line];
    });
  return Buffer.from(syntheticPdf(markdown.split(/^---page---$/m).map((page) => wrap(page.trim()))));
}

export async function startAcceptanceDeal(packId: PackId, currency: string, options: { dataClasses?: Record<string, string> } = {}): Promise<AcceptanceDeal> {
  const repo = resolve(import.meta.dirname, '../../../..');
  const out = mkdtempSync(join(tmpdir(), `pactlab-${packId.toLowerCase()}-`));
  const run = spawnSync('python3', [join(repo, 'scripts/demo-data/generate.py'), out], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
  const pack = PACKS[packId];
  const folder = join(out, pack.slug, currency);
  const storeDir = mkdtempSync(join(tmpdir(), 'pactlab-acceptance-uploads-'));

  const db: TestDatabase = await startTestDatabase();
  const a: SyntheticTenant = await createSyntheticTenant(db.owner, 'Alpha');
  const b: SyntheticTenant = await createSyntheticTenant(db.owner, 'Bravo');
  const pair = await generateKeyPair('RS256');
  const key: CryptoKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
  const app = await createApp({
    prisma: db.prisma,
    identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
    logger: createLogger('api-test', { level: process.env['TEST_LOG'] ? 'error' : 'silent' }),
    uploads: { objectStore: new FileSystemObjectStore(storeDir), malwareScanner: new SignatureMalwareScanner() },
    documents: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner() },
  });
  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);
  const tokens: Record<string, string> = { lead: await token(a.subject, a.auth0OrganizationId), other: await token(b.subject, b.auth0OrganizationId) };

  const call: AcceptanceDeal['call'] = async (method, url, who, payload) => {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who] ?? ''}` }, ...(payload !== undefined ? { payload: payload as Body } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Body };
  };

  const pact = await call('POST', '/v1/pacts', 'lead', {
    name: `Project ${pack.label}`,
    baseCurrency: currency,
    buyer: { name: 'Alpha Capital', ownership: 'PRIVATE' },
    seller: { name: `${pack.label} target (synthetic)`, ownership: 'PRIVATE', companyType: packId },
  });
  expect(pact.status, JSON.stringify(pact.body)).toBe(201);
  const dealId = pact.body['id'] as string;
  for (const role of ['REVIEWER', 'TARGET_CONTRIBUTOR'] as const) {
    const member = await addSyntheticDealMember(db.owner, { ...a, dealId }, role);
    tokens[role.toLowerCase()] = await token(member.subject, a.auth0OrganizationId);
  }

  const importCsv = async (file: string, target: string) => {
    const query = new URLSearchParams({ system: 'pactlab_standard', fileName: file, ...(target === 'BILLING_INVOICE_LINE' ? {} : { target }) });
    const uploaded = await app.inject({
      method: 'POST',
      url: `/v1/deals/${dealId}/uploads?${query.toString()}`,
      headers: { authorization: `Bearer ${tokens['lead'] ?? ''}`, 'content-type': 'text/csv' },
      payload: readFileSync(join(folder, file)),
    });
    expect(uploaded.statusCode, `${file}: ${uploaded.body}`).toBe(201);
    const upload = uploaded.json() as { id: string; suggestedMapping: Body };
    const imported = await call('POST', `/v1/deals/${dealId}/uploads/${upload.id}/import`, 'lead', { mapping: upload.suggestedMapping });
    expect(imported.status, `${file}: ${JSON.stringify(imported.body)}`).toBe(200);
    expect(imported.body['syncRun'], file).toMatchObject({ status: 'SUCCEEDED', issuesCount: 0 });
  };
  for (const target of pack.importTargets) await importCsv(IMPORT_TARGET_DEFINITIONS[target].fileName, target);
  for (const file of readdirSync(join(folder, 'documents')).filter((name) => name.endsWith('.md'))) {
    const uploaded = await call('POST', `/v1/deals/${dealId}/documents`, 'lead', {
      fileName: file.replace(/\.md$/, '.pdf'),
      contentType: 'application/pdf',
      contentBase64: pdfOf(readFileSync(join(folder, 'documents', file), 'utf8')).toString('base64'),
      dataClass: options.dataClasses?.[file] ?? (file.startsWith('99-') ? 'FINANCIAL' : 'BUSINESS'),
    });
    expect(uploaded.status, `${file}: ${JSON.stringify(uploaded.body)}`).toBe(201);
  }

  return {
    app,
    dealId,
    folder,
    readme: readFileSync(join(folder, 'README.md'), 'utf8'),
    call,
    close: async () => {
      await app.close();
      await db.stop();
      for (const dir of [out, storeDir]) rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Every built pack with rules has an acceptance folder per currency (guards the harness inputs). */
export const ACCEPTANCE_CURRENCIES = ['USD', 'EUR', 'GBP'] as const;
export const BUILT_PACKS = PACK_IDS.filter((id) => PACKS[id].built && PACKS[id].findingRules.length > 0);

export type BridgeLine = { kind: string; findingId?: string; amount: { amount: string } };

/**
 * The human path from a drafted pack finding to a valuation run: optionally
 * price it (as a reviewer would for a drag the rule leaves unpriced), submit,
 * accept as a second person, link it to a scenario and run it. Returns the
 * run's purchase-price bridge lines.
 */
export async function acceptAndValue(
  deal: AcceptanceDeal,
  finding: { id: string; version: number },
  options: { pricedRisk?: { type: string; currency: string; low: string; high: string; basis: string }; assumptions?: Record<string, unknown> } = {},
): Promise<BridgeLine[]> {
  const base = `/v1/deals/${deal.dealId}/findings/${finding.id}`;
  let version = finding.version;
  if (options.pricedRisk) {
    const priced = await deal.call('PATCH', base, 'lead', { expectedVersion: version, pricedRisk: options.pricedRisk });
    expect(priced.status, JSON.stringify(priced.body)).toBe(200);
    version = Number(priced.body['version']);
  }
  const submitted = await deal.call('POST', `${base}/reviews`, 'lead', { expectedVersion: version, decision: 'SUBMITTED', rationale: 'Sources checked (synthetic)' });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  const accepted = await deal.call('POST', `${base}/reviews`, 'reviewer', { expectedVersion: version + 1, decision: 'ACCEPTED', rationale: 'Evidence supports the finding (synthetic)' });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  const scenarios = `/v1/deals/${deal.dealId}/valuation/scenarios`;
  const created = await deal.call('POST', scenarios, 'lead', {
    name: 'Base case',
    values: {
      assumptions: options.assumptions ?? { method: 'ARR_MULTIPLE', arr: '6000000.00', multiple: '3' },
      bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
      findingLinks: [{ findingId: finding.id, point: 'LOW' }],
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const scenarioId = (created.body['scenario'] as { id: string }).id;
  const ran = await deal.call('POST', `${scenarios}/${scenarioId}/runs`, 'lead', { expectedVersion: 1 });
  expect(ran.status, JSON.stringify(ran.body)).toBe(201);
  return (ran.body['latestRun'] as { result: { bridge: { lines: BridgeLine[] } } }).result.bridge.lines;
}
