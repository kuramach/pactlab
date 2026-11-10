import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { FixturePropertyProvider } from '@pactlab/connectors';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { packFor, type CompanyType } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { DisabledIdentityVerifier } from '../auth/identity';
import { demoModelResponse } from '../demo-seed/seed';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import { DEMO_ORG, pactName, pactVariants, runDemoOrg, type DemoDataSource } from './demo-org';

type Row = Record<string, unknown>;

/** The public demo data, generated as the pack acceptance tests do (the deployed run reads the same files at a pinned commit). */
function generatedDemoData(): { source: DemoDataSource; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pactlab-demo-org-'));
  const run = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/generate.py'), dir], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`generate.py failed: ${run.stderr}`);
  const room = spawnSync('python3', [resolve(import.meta.dirname, '../../../../scripts/demo-data/dataroom.py'), dir], { encoding: 'utf8' });
  if (room.status !== 0) throw new Error(`dataroom.py failed: ${room.stderr}`);
  const base = (type: CompanyType) => join(dir, packFor(type).slug, 'USD');
  return {
    dir,
    source: {
      file: async (type, path) => readFileSync(join(base(type), path)),
      documents: async (type) => readdirSync(join(base(type), 'documents')),
    },
  };
}

describe('demo organization (batch 2)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let other: SyntheticTenant;
  let first: string[] = [];
  const demoData = generatedDemoData();
  const rows = async (sql: string, params: unknown[] = []) => ((await db.owner.query(sql, params)) as { rows: Row[] }).rows;
  const types = ['SOFTWARE_SAAS', 'MULTIFAMILY', 'VENTURE_RAISE'] as const;
  const run = (reset = false) => runDemoOrg(app as never, db.owner as never, db.prisma, { types, reset, data: demoData.source });

  beforeAll(async () => {
    db = await startTestDatabase();
    other = await createSyntheticTenant(db.owner, 'Bystander');
    const synthetic = { modelId: 'synthetic-fixture', effort: 'low' } as const;
    const store = new InMemoryObjectStore();
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new DisabledIdentityVerifier(),
      logger: createLogger('api-test', { level: 'silent' }),
      uploads: { objectStore: store, malwareScanner: new SignatureMalwareScanner() },
      documents: {
        objectStore: store,
        malwareScanner: new SignatureMalwareScanner(),
        gateway: new TransportClaudeGateway({ transport: new ScriptedModelTransport(demoModelResponse), registry: defaultPromptRegistry(), routes: { balanced: synthetic, deep_review: synthetic, fast: synthetic } }),
      },
      property: new FixturePropertyProvider(),
      signing: { fixture: false, docusign: null },
    });
    first = await run();
  }, 600_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
    rmSync(demoData.dir, { recursive: true, force: true });
  });

  it('creates the demo organization, marked DEMO, with the buyer as owner', async () => {
    const [org] = await rows(`SELECT name, slug, status, auth_method, created_via FROM organizations WHERE id = $1`, [DEMO_ORG.id]);
    expect(org).toEqual({ name: DEMO_ORG.name, slug: 'pactlab-demo', status: 'ACTIVE', auth_method: 'EMAIL_CODE', created_via: 'DEMO' });
    const owners = await rows(`SELECT u.email FROM organization_memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 AND m.role = 'ORG_OWNER'`, [DEMO_ORG.id]);
    expect(owners).toEqual([{ email: DEMO_ORG.buyer.email }]);
  });

  it('builds each pact to funds confirmed, with the seller as a contributor', async () => {
    expect(first.filter((line) => line.includes('FAILED'))).toEqual([]);
    for (const type of types) {
      const [deal] = await rows(`SELECT id FROM deals WHERE organization_id = $1 AND name = $2`, [DEMO_ORG.id, pactName(type)]);
      expect(deal, pactName(type)).toBeDefined();
      const dealId = deal!['id'] as string;
      const [seller] = await rows(`SELECT role FROM deal_memberships WHERE deal_id = $1 AND user_id = $2`, [dealId, DEMO_ORG.seller.id]);
      expect(seller).toEqual({ role: 'TARGET_CONTRIBUTOR' });
      expect(await rows(`SELECT scenario_case FROM valuation_scenarios WHERE deal_id = $1 ORDER BY scenario_case`, [dealId])).toHaveLength(3);
      expect((await rows(`SELECT 1 FROM documents WHERE deal_id = $1`, [dealId])).length).toBeGreaterThan(0);
      expect((await rows(`SELECT 1 FROM findings WHERE deal_id = $1 AND status = 'ACCEPTED'`, [dealId])).length, pactName(type)).toBeGreaterThan(0);
    }
    expect(first.some((line) => line.includes('published teaser'))).toBe(true);
  });

  it('fills every tab: screening, sources, finances, regulatory, claims, Sextant, the raise, post-close, bidders and reports', async () => {
    expect(first.filter((line) => line.includes('FAILED'))).toEqual([]);
    const deal = async (name: string) => ((await rows(`SELECT id, stage FROM deals WHERE organization_id = $1 AND name = $2`, [DEMO_ORG.id, name]))[0] ?? {}) as { id: string; stage: string };
    const count = async (table: string, dealId: string, where = '') => ((await rows(`SELECT count(*)::int AS n FROM ${table} WHERE deal_id = $1 ${where}`, [dealId]))[0] as { n: number }).n;
    for (const type of types) {
      const { id, stage } = await deal(pactName(type));
      expect(stage, type).not.toBe('SCREENING');
      expect(await count('deal_claims', id), type).toBeGreaterThanOrEqual(3);
      expect(await count('balance_sheet_items', id), type).toBe(4);
      expect(await count('regulatory_entries', id), type).toBe(3);
      expect(await count('deal_memberships', id, `AND role = 'ANALYST'`), type).toBe(1);
      if (type !== 'VENTURE_RAISE') {
        expect(await count('asking_prices', id), type).toBeGreaterThan(0);
        expect(await count('multiple_judgements', id), type).toBe(1);
      }
    }
    const saas = await deal(pactName('SOFTWARE_SAAS'));
    expect(await count('connections', saas.id, `AND provider IN ('github', 'jira')`), 'GitHub and Jira').toBe(2);
    expect(await count('negotiation_anchors', saas.id)).toBeGreaterThan(0);
    expect(await count('negotiation_anchors', (await deal(pactName('MULTIFAMILY'))).id), 'property anchors').toBeGreaterThan(0);
    expect((await rows(`SELECT 1 FROM evidence_items WHERE deal_id = $1 AND connection_id IS NOT NULL LIMIT 1`, [saas.id])).length, 'synced code and delivery evidence').toBe(1);
    expect(await count('connections', (await deal(pactName('MULTIFAMILY'))).id, `AND provider IN ('github', 'jira')`), 'no code sources for property').toBe(0);
    const venture = await deal(pactName('VENTURE_RAISE'));
    expect(await count('venture_offers', venture.id)).toBe(3);
    expect((await deal(pactName('VENTURE_RAISE', true))).id, 'a raise has no closed variant').toBeUndefined();
    for (const type of ['SOFTWARE_SAAS', 'MULTIFAMILY'] as const) {
      const closed = await deal(pactName(type, true));
      expect(closed.stage, type).toBe('CLOSED');
      expect(await count('post_close_items', closed.id), type).toBeGreaterThan(0);
    }
    const teaser = (await rows(`SELECT id FROM deals WHERE organization_id = $1 AND initiated_by = 'SELLER'`, [DEMO_ORG.id]))[0] as { id: string };
    expect(await count('bids', teaser.id)).toBe(3);
    expect(await count('bid_offers', teaser.id)).toBe(2);
    expect(await count('deal_memberships', teaser.id, `AND role = 'BIDDER'`)).toBe(3);
    expect(await rows(`SELECT scope, status FROM report_versions WHERE organization_id = $1 ORDER BY scope`, [DEMO_ORG.id])).toEqual([{ scope: 'EXECUTIVE', status: 'READY' }, { scope: 'PACT', status: 'READY' }]);
  });

  it('adds nothing on a re-run', async () => {
    const before = await rows(`SELECT count(*)::int AS n FROM deals WHERE organization_id = $1`, [DEMO_ORG.id]);
    const again = await run();
    expect(again.filter((line) => line.endsWith('already present'))).toHaveLength(types.flatMap(pactVariants).length);
    expect(await rows(`SELECT count(*)::int AS n FROM deals WHERE organization_id = $1`, [DEMO_ORG.id])).toEqual(before);
  });

  it('resets only the demo organization', { timeout: 120_000 }, async () => {
    const report = await run(true);
    expect(report[0]).toMatch(/^reset: \d+ demo pacts deleted$/);
    expect(await rows(`SELECT name FROM deals WHERE organization_id = $1 AND status = 'DELETED'`, [other.organizationId])).toEqual([]);
    expect((await rows(`SELECT 1 FROM deals WHERE organization_id = $1 AND status <> 'DELETED'`, [other.organizationId])).length).toBeGreaterThan(0);
    expect(report.filter((line) => line.includes('FAILED'))).toEqual([]);
  });

  it('refuses when another organization holds the demo slug', async () => {
    await db.owner.query(`UPDATE organizations SET slug = 'pactlab-demo-x' WHERE id = $1`, [DEMO_ORG.id]);
    await db.owner.query(`UPDATE organizations SET slug = 'pactlab-demo' WHERE id = $1`, [other.organizationId]);
    await expect(run()).rejects.toThrow(/refusing/);
  });
});
