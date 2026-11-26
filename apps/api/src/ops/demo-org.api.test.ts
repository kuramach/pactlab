import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { FixturePropertyProvider } from '@pactlab/connectors';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { DisabledIdentityVerifier } from '../auth/identity';
import { demoModelResponse } from '../demo-seed/seed';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import { DEMO_COVERAGE_EXCEPTIONS, DEMO_SECTION_COVERAGE } from './demo-coverage';
import { DEMO_ORG, KAFKA_PACT, pactName, pactVariants, runDemoOrg } from './demo-org';
import { DEAL_SECTION_RULES, sectionApplies, type CompanyType } from '@pactlab/domain';
import { generatedDemoData } from './demo-data.testing';

type Row = Record<string, unknown>;

describe('demo organization (batch 2)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let other: SyntheticTenant;
  let first: string[] = [];
  const demoData = generatedDemoData();
  const rows = async (sql: string, params: unknown[] = []) => ((await db.owner.query(sql, params)) as { rows: Row[] }).rows;
  const types = ['SOFTWARE_SAAS', 'MULTIFAMILY', 'VENTURE_RAISE', 'MULTIFAMILY_SYNDICATION', 'MUSIC_RIGHTS', 'ENERGY_GENERATION', 'STARTUP_SPV', 'FINTECH', 'HEALTHCARE'] as const;
  const run = (reset = false, only: readonly (typeof types)[number][] = types) => runDemoOrg(app as never, db.owner as never, db.prisma, { types: only, reset, data: demoData.source });

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
      // A raise sets its own round and an SPV buys in at the round's pre-money: neither has an asking price.
      if (type !== 'VENTURE_RAISE' && type !== 'STARTUP_SPV') {
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
    expect(await rows(`SELECT scope, status FROM report_versions WHERE organization_id = $1 AND scope <> 'IC' ORDER BY scope`, [DEMO_ORG.id])).toEqual([{ scope: 'EXECUTIVE', status: 'READY' }, { scope: 'PACT', status: 'READY' }]);
    // Each buyer-led acquisition pact has its committee pack (T-124 demo coverage).
    expect((await rows(`SELECT count(*)::int AS n FROM report_versions WHERE organization_id = $1 AND scope = 'IC'`, [DEMO_ORG.id]))[0]).toEqual({ n: 14 });
    // The syndication pact reads its offering, and the seller sees none of the sponsor's offering documents (T-106).
    const syndication = await deal(pactName('MULTIFAMILY_SYNDICATION'));
    expect(await count('syndication_offerings', syndication.id)).toBe(1);
    expect(await count('syndication_offering_items', syndication.id, `AND status = 'CONFIRMED'`)).toBeGreaterThan(10);
    expect(await count('findings', syndication.id, `AND title = 'Fee in the operating agreement missing from the PPM: loan guarantee fee' AND status = 'DRAFT'`)).toBe(1);
    expect(await count('documents', syndication.id, `AND visibility = 'SHARED'`)).toBe(0);
    // The music catalog reads its rights documents into the register, confirmed by the buyer (T-140).
    const music = await deal(pactName('MUSIC_RIGHTS'));
    expect(await count('music_register_items', music.id, `AND status = 'CONFIRMED'`)).toBeGreaterThanOrEqual(3);
    expect(await count('findings', music.id, `AND title = 'Termination exposure inside the hold period'`)).toBe(1);
    // The energy package reads its reserve report and environmental reports, confirmed by the buyer (T-142).
    const energy = await deal(pactName('ENERGY_GENERATION'));
    expect(await count('energy_register_items', energy.id, `AND status = 'CONFIRMED'`)).toBeGreaterThanOrEqual(5);
    expect(await count('findings', energy.id, `AND title = 'ARO shortfall: Cinder Ridge Station (synthetic)'`)).toBe(1);
    // The fintech pact imports its processor exports, licence register and three years of P&L; the planted defects are drafted (T-159).
    const fintech = await deal(pactName('FINTECH'));
    expect(await count('evidence_items', fintech.id, `AND evidence_type = 'finance.pnl_line'`)).toBe(30);
    for (const title of ['Claim contradicted: Total payment volume', 'Chargeback rate breaches the stated threshold, 2026-Q3', 'Fraud losses growing faster than revenue, 2023–2025']) {
      expect(await count('findings', fintech.id, `AND title = '${title}'`), title).toBe(1);
    }
    expect(await count('findings', fintech.id, `AND title LIKE 'Lapsed: %'`)).toBe(1);
    // The healthcare pact imports its remittances, collections by clinician, registers and three years of P&L; the planted defects are drafted (T-160).
    const healthcare = await deal(pactName('HEALTHCARE'));
    expect(await count('evidence_items', healthcare.id, `AND evidence_type = 'finance.pnl_line'`)).toBe(24);
    for (const title of ['Claim contradicted: Denial rate', 'Denial rate rising, 2023–2025', 'Claim contradicted: Commercial payer share', 'Payer mix shifted toward Medicaid, the lowest-paying payer class, 2023–2025', '31.0% of collections from one clinician, no non-compete on file: PR-03', 'Denial write-offs and bad debt growing faster than revenue, 2023–2025']) {
      expect(await count('findings', healthcare.id, `AND title = '${title}'`), title).toBe(1);
    }
    expect(await count('findings', healthcare.id, `AND title LIKE 'Practising on an expired licence: %'`)).toBe(2);
    // The SPV seats its investors, runs its checks and publishes the investor view; the startup sees none of the vehicle's papers (T-141).
    const spv = await deal(pactName('STARTUP_SPV'));
    expect(await count('pact_investors', spv.id)).toBe(5);
    expect(await count('investor_view_versions', spv.id)).toBe(1);
    expect(await count('findings', spv.id, `AND title = 'Accreditation gap in a 506(c) vehicle'`)).toBe(1);
    expect(await count('documents', spv.id, `AND visibility = 'SHARED'`)).toBe(0);
  });

  it('every section a demo pact shows has data, derived from the section rules, not a list kept by hand (T-124)', async () => {
    // A new section must say where its demo data lives (or why it has none) before it ships.
    expect(Object.keys(DEMO_SECTION_COVERAGE).sort()).toEqual(Object.keys(DEAL_SECTION_RULES).sort());
    const pacts = (await rows(
      `SELECT d.id, d.initiated_by, p.company_type FROM deals d LEFT JOIN deal_parties p ON p.deal_id = d.id AND p.role = 'SELLER' WHERE d.organization_id = $1`,
      [DEMO_ORG.id],
    )) as { id: string; initiated_by: 'BUYER' | 'SELLER'; company_type: CompanyType | null }[];
    const groups = new Map<string, typeof pacts>();
    for (const pact of pacts) groups.set(`${pact.company_type}/${pact.initiated_by}`, [...(groups.get(`${pact.company_type}/${pact.initiated_by}`) ?? []), pact]);
    const empty: string[] = [];
    for (const [group, members] of groups) {
      const [companyType, initiatedBy] = group.split('/') as [CompanyType, 'BUYER' | 'SELLER'];
      for (const [section, probe] of Object.entries(DEMO_SECTION_COVERAGE)) {
        if ('exempt' in probe || !sectionApplies(section, { companyType, initiatedBy }) || DEMO_COVERAGE_EXCEPTIONS[`${section}@${group}`]) continue;
        let found = 0;
        for (const pact of members) {
          const [row] = await rows(`SELECT count(*)::int AS n FROM ${probe.table} WHERE ${probe.column ?? 'deal_id'} = $1${probe.where ? ` AND ${probe.where}` : ''}`, [pact.id]);
          found += (row as { n: number }).n;
        }
        if (found === 0) empty.push(`${section || '(summary)'} @ ${group}`);
      }
    }
    expect(empty, 'Give these demo pacts data for the section, or add a reviewed DEMO_COVERAGE_EXCEPTIONS entry with the reason.').toEqual([]);
  });

  it('the Kafka demo (T-127): real apache/kafka and KAFKA activity from the recorded snapshot, linked both ways, no live call', async () => {
    const [kafka] = await rows(`SELECT id FROM deals WHERE organization_id = $1 AND name = $2`, [DEMO_ORG.id, KAFKA_PACT]);
    expect(kafka, KAFKA_PACT).toBeDefined();
    const dealId = kafka!['id'] as string;
    // Fixture mode only: the snapshot is replayed; nothing in the pact can reach GitHub or Jira.
    const connections = await rows(`SELECT provider, mode, display_name FROM connections WHERE deal_id = $1 ORDER BY provider`, [dealId]);
    expect(connections.map((row) => [row['provider'], row['mode']])).toEqual([['github', 'FIXTURE'], ['jira', 'FIXTURE']]);
    expect(connections.every((row) => /real public data, recorded \d{4}-\d{2}-\d{2}/.test(String(row['display_name'])))).toBe(true);
    const types = await rows(`SELECT evidence_type, count(*)::int AS n FROM evidence_items WHERE deal_id = $1 GROUP BY evidence_type`, [dealId]);
    const count = (type: string) => (types.find((row) => row['evidence_type'] === type)?.['n'] as number | undefined) ?? 0;
    expect(count('code.pull_request'), 'pull requests').toBeGreaterThan(0);
    expect(count('code.contributor_activity'), 'contributor activity').toBeGreaterThan(0);
    expect(count('delivery.issue'), 'KAFKA issues').toBeGreaterThan(0);
    // Code → issue links: KAFKA keys in commits and pull requests resolve to recorded issues.
    expect(count('code.issue_link'), 'KAFKA links').toBeGreaterThan(0);
    // People are pseudonymous: nothing synced carries an email address.
    expect(await rows(`SELECT 1 FROM evidence_items WHERE deal_id = $1 AND canonical::text ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\\.[A-Za-z]{2,}' LIMIT 1`, [dealId])).toEqual([]);
  });

  it('adds nothing on a re-run', async () => {
    const before = await rows(`SELECT count(*)::int AS n FROM deals WHERE organization_id = $1`, [DEMO_ORG.id]);
    const again = await run();
    expect(again.filter((line) => line.endsWith('already present'))).toHaveLength(types.flatMap(pactVariants).length);
    expect(await rows(`SELECT count(*)::int AS n FROM deals WHERE organization_id = $1`, [DEMO_ORG.id])).toEqual(before);
  });

  // Deletes every demo pact, then seeds one pack again: the reset is what is under test (the full seed is covered
  // above), so it stays well inside the limit as packs are added (it timed out on CI at five pacts).
  it('resets only the demo organization', { timeout: 300_000 }, async () => {
    const report = await run(true, ['SOFTWARE_SAAS']);
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
