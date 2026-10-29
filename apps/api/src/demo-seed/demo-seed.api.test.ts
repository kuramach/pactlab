import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultPromptRegistry, ScriptedModelTransport, TransportClaudeGateway } from '@pactlab/ai';
import { seedSynthetic } from '@pactlab/db/seed';
import { startTestDatabase, type TestDatabase } from '@pactlab/db/testing';
import { createLogger } from '@pactlab/observability';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { DisabledIdentityVerifier } from '../auth/identity';
import { InMemoryObjectStore } from '../documents/testing';
import { SignatureMalwareScanner } from '../documents/upload-policy';
import { CASE_1_NAME, demoModelResponse, seedDemo } from './seed';

type Row = Record<string, unknown>;
const CHARLIE = '01900000-0000-7000-8000-00000000c001';

describe('synthetic decision-loop seed', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let report: string[] = [];
  const rows = async (sql: string, params: unknown[] = []) => ((await db.owner.query(sql, params)) as { rows: Row[] }).rows;

  beforeAll(async () => {
    db = await startTestDatabase();
    await seedSynthetic(db.owner, db.prisma);
    const synthetic = { modelId: 'synthetic-fixture', effort: 'low' } as const;
    app = await createApp({
      prisma: db.prisma,
      identityVerifier: new DisabledIdentityVerifier(),
      logger: createLogger('api-test', { level: 'silent' }),
      uploads: { objectStore: new InMemoryObjectStore(), malwareScanner: new SignatureMalwareScanner() },
      documents: {
        objectStore: new InMemoryObjectStore(),
        malwareScanner: new SignatureMalwareScanner(),
        gateway: new TransportClaudeGateway({
          transport: new ScriptedModelTransport(demoModelResponse),
          registry: defaultPromptRegistry(),
          routes: { balanced: synthetic, deep_review: synthetic, fast: synthetic },
        }),
      },
    });
    report = await seedDemo(app, db.prisma);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('seeds both synthetic buyer organizations', () => {
    expect(report.filter((line) => line.includes('missing'))).toEqual([]);
    expect(report.some((line) => line.startsWith('Alpha ·'))).toBe(true);
    expect(report.some((line) => line.startsWith('Charlie ·'))).toBe(true);
  });

  it('puts findings at every review stage, with priced risks and named reviewers', async () => {
    const statuses = await rows(
      `SELECT f.status, count(*)::int AS n FROM findings f JOIN deals d ON d.id = f.deal_id
        WHERE d.organization_id = $1 AND d.name = 'Project Troubled' GROUP BY f.status ORDER BY f.status`,
      [CHARLIE],
    );
    expect(Object.fromEntries(statuses.map((row) => [row['status'], row['n']]))).toMatchObject({ ACCEPTED: 1, IN_REVIEW: 1 });
    const reviews = await rows(
      `SELECT r.decision, u.display_name FROM finding_reviews r JOIN users u ON u.id = r.reviewer_user_id
        WHERE r.organization_id = $1 ORDER BY r.decided_at`,
      [CHARLIE],
    );
    expect(reviews).toContainEqual({ decision: 'ACCEPTED', display_name: 'Charlie Reviewer (synthetic)' });
  });

  it('creates scenarios from draft to approved, approved by a second person', async () => {
    const scenarios = await rows(
      `SELECT s.name, s.status, (SELECT count(*)::int FROM valuation_runs r WHERE r.scenario_id = s.id) AS runs
         FROM valuation_scenarios s WHERE s.organization_id = $1 ORDER BY s.name`,
      [CHARLIE],
    );
    expect(scenarios).toEqual([
      { name: 'Base case — ARR multiple', status: 'APPROVED', runs: 1 },
      // Run once with entered amounts, then again with the cited balance-sheet items.
      { name: 'Base case — ARR multiple, risk-adjusted', status: 'DRAFT', runs: 2 },
      { name: 'Downside — DCF', status: 'DRAFT', runs: 1 },
      { name: 'Early look — DCF', status: 'DRAFT', runs: 0 },
    ]);
  });

  it('loads Case 1 (T-092) as a demo pact with its regulatory draft findings', async () => {
    // Seeded for each demo organization.
    const lines = report.filter((line) => line.includes(CASE_1_NAME));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toContain(`${CASE_1_NAME}: footprint, package, 7 documents, 9 cited entries; 10 regulatory draft findings`);
    const findings = await rows(`SELECT count(*)::int AS n FROM findings f JOIN deals d ON d.id = f.deal_id WHERE d.name = $1 AND f.domain = 'REGULATORY' AND f.status = 'DRAFT'`, [CASE_1_NAME]);
    expect(findings[0]?.['n']).toBeGreaterThanOrEqual(10);
  });

  it('uploads contracts with cited AI drafts recorded as synthetic, one accepted by the reviewer', async () => {
    const docs = await rows(`SELECT count(*)::int AS n FROM documents d JOIN deals p ON p.id = d.deal_id WHERE d.organization_id = $1 AND p.name <> $2`, [CHARLIE, CASE_1_NAME]);
    // Four contracts and Troubled's balance sheet (Case 1's six documents are counted in its own test).
    expect(docs[0]!['n']).toBe(5);
    const models = await rows(`SELECT DISTINCT resolved_model_id FROM ai_runs WHERE organization_id = $1`, [CHARLIE]);
    expect(models).toEqual([{ resolved_model_id: 'synthetic-fixture' }]);
    const decided = await rows(
      `SELECT status, reviewer_display_name FROM document_findings WHERE organization_id = $1 AND status <> 'DRAFT'`,
      [CHARLIE],
    );
    expect(decided).toEqual([{ status: 'ACCEPTED', reviewer_display_name: 'Charlie Reviewer (synthetic)' }]);
    const drafts = await rows(`SELECT count(*)::int AS n FROM document_findings WHERE organization_id = $1 AND status = 'DRAFT'`, [CHARLIE]);
    expect(drafts[0]!['n']).toBeGreaterThanOrEqual(4);
  });

  it('records asking prices, with a revision on Troubled', async () => {
    const prices = await rows(
      `SELECT d.name, a.version, a.amount::text AS amount, a.basis FROM asking_prices a JOIN deals d ON d.id = a.deal_id
        WHERE a.organization_id = $1 ORDER BY d.name, a.version`,
      [CHARLIE],
    );
    expect(prices).toEqual([
      { name: 'Project Healthy', version: 1, amount: '2800000.0000', basis: 'ENTERPRISE_VALUE' },
      { name: 'Project Sparse', version: 1, amount: '900000.0000', basis: 'EQUITY_VALUE' },
      { name: 'Project Troubled', version: 1, amount: '1500000.0000', basis: 'ENTERPRISE_VALUE' },
      { name: 'Project Troubled', version: 2, amount: '1350000.0000', basis: 'ENTERPRISE_VALUE' },
    ]);
  });

  it('records labelled synthetic comparables, Healthy as an own-deal precedent and the lead\'s call on Troubled', async () => {
    const origins = await rows(
      `SELECT origin, count(*)::int AS n FROM comparables WHERE organization_id = $1 GROUP BY origin ORDER BY origin`,
      [CHARLIE],
    );
    expect(origins).toEqual([
      { origin: 'OWN_DEAL', n: 1 },
      { origin: 'SYNTHETIC', n: 15 },
    ]);
    const unlabelled = await rows(`SELECT count(*)::int AS n FROM comparables WHERE origin = 'SYNTHETIC' AND name NOT LIKE 'Synthetic %'`);
    expect(unlabelled[0]!['n']).toBe(0);
    const judgements = await rows(
      `SELECT d.name, j.verdict, j.asking_version, j.asking_multiple::text AS multiple FROM multiple_judgements j JOIN deals d ON d.id = j.deal_id
        WHERE j.organization_id = $1`,
      [CHARLIE],
    );
    expect(judgements).toEqual([{ name: 'Project Troubled', verdict: 'HIGH', asking_version: 2, multiple: '5.04' }]);
    const anchors = await rows(
      `SELECT c.target_name, c.arr_basis FROM negotiation_anchors a JOIN comparables c ON c.id = a.comparable_id
        WHERE a.organization_id = $1 AND a.status = 'ACTIVE' ORDER BY c.target_name`,
      [CHARLIE],
    );
    expect(anchors).toEqual([
      { target_name: 'Quayside Systems (synthetic)', arr_basis: 'REVENUE' },
      { target_name: 'Tallyhouse (synthetic)', arr_basis: 'ARR' },
    ]);
  });

  it('backs Troubled\'s base case with cited balance-sheet items, at an unchanged equity value', async () => {
    const items = await rows(
      `SELECT kind, category, amount::text AS amount, citation->>'quote' AS quote FROM balance_sheet_items WHERE organization_id = $1 ORDER BY balance_sheet_items.amount`,
      [CHARLIE],
    );
    expect(items.map((item) => [item['kind'], item['amount']])).toEqual([
      ['DEBT_LIKE', '13000.0000'],
      ['DEBT_LIKE', '22000.0000'],
      ['CASH', '90000.0000'],
      ['DEBT', '120000.0000'],
    ]);
    const runs = await rows(
      `SELECT r.result->>'engineVersion' AS engine, r.result->'bridge'->'equityValue'->>'amount' AS equity
         FROM valuation_runs r JOIN valuation_scenarios s ON s.id = r.scenario_id
        WHERE s.organization_id = $1 AND s.name = 'Base case — ARR multiple, risk-adjusted' ORDER BY r.ran_at`,
      [CHARLIE],
    );
    expect(runs.map((run) => run['equity'])).toEqual([runs[0]!['equity'], runs[0]!['equity']]);
    expect(runs.at(-1)!['engine']).toBe('valuation-2');
  });

  it('proposes directions: drags on Troubled, an accepted engineering-continuity cushion on Healthy', async () => {
    const rows2 = await rows(
      `SELECT d.name, f.title, f.status, f.direction, f.value_driver FROM findings f JOIN deals d ON d.id = f.deal_id
        WHERE f.organization_id = $1 ORDER BY d.name, f.title`,
      [CHARLIE],
    );
    expect(rows2.filter((row) => row['name'] === 'Project Troubled').every((row) => row['direction'] === -1)).toBe(true);
    expect(rows2.filter((row) => row['name'] === 'Project Healthy')).toEqual([
      // The accepted document-review finding, brought into the register to be priced (T-077).
      { name: 'Project Healthy', title: 'Change of control clause', status: 'DRAFT', direction: null, value_driver: null },
      { name: 'Project Healthy', title: 'Ownership spread across the engineering team', status: 'ACCEPTED', direction: 1, value_driver: 'Engineering continuity' },
    ]);
  });

  it('has a pact in each phase: screening pending, diligence with claims, closed with registers (T-071)', async () => {
    const stages = await rows(`SELECT d.name, d.stage FROM deals d WHERE d.organization_id = $1 ORDER BY d.name`, [CHARLIE]);
    expect(stages).toEqual(expect.arrayContaining([{ name: 'Project Healthy', stage: 'CLOSED' }, { name: 'Project Troubled', stage: 'DILIGENCE' }]));
    expect(stages.some((row) => row['stage'] === 'SCREENING')).toBe(true);
    const screening = await rows(`SELECT s.verdict, jsonb_array_length(s.red_flags) AS flags FROM screening_reviews s WHERE s.organization_id = $1`, [CHARLIE]);
    expect(screening).toEqual([{ verdict: null, flags: 2 }]);
    const claims = await rows(`SELECT c.status FROM deal_claims c JOIN deals d ON d.id = c.deal_id WHERE d.organization_id = $1 AND d.name = 'Project Troubled' ORDER BY c.status`, [CHARLIE]);
    expect(claims.map((row) => row['status'])).toEqual(['CONTRADICTED', 'UNVERIFIED']);
    const registers = await rows(`SELECT p.kind FROM post_close_items p JOIN deals d ON d.id = p.deal_id WHERE d.organization_id = $1 AND d.name = 'Project Healthy'`, [CHARLIE]);
    expect(registers.map((row) => row['kind'])).toContain('ASSET');
  });

  it('has a Foresight baseline and one user scenario on Project Troubled (T-073)', async () => {
    const sets = await rows(`SELECT s.model_id, (SELECT count(*)::int FROM foresight_trends t WHERE t.trend_set_id = s.id) AS trends FROM foresight_trend_sets s JOIN deals d ON d.id = s.deal_id WHERE d.organization_id = $1 AND d.name = 'Project Troubled'`, [CHARLIE]);
    expect(sets).toEqual([{ model_id: 'synthetic-fixture', trends: 7 }]);
    const scenarios = await rows(`SELECT f.name FROM foresight_scenarios f JOIN deals d ON d.id = f.deal_id WHERE d.organization_id = $1`, [CHARLIE]);
    expect(scenarios).toEqual([{ name: 'Rates stay high' }]);
  });

  it('changes nothing when run again', async () => {
    const count = async () =>
      rows(
        `SELECT (SELECT count(*) FROM valuation_scenarios)::int AS s, (SELECT count(*) FROM documents)::int AS d,
                (SELECT count(*) FROM asking_prices)::int AS a, (SELECT count(*) FROM comparables)::int AS c,
                (SELECT count(*) FROM multiple_judgements)::int AS j, (SELECT count(*) FROM negotiation_anchors)::int AS n, (SELECT count(*) FROM balance_sheet_items)::int AS b,
                (SELECT count(*) FROM finding_reviews)::int AS r, (SELECT count(*) FROM document_findings)::int AS f`,
      );
    const before = await count();
    await seedDemo(app, db.prisma);
    expect(await count()).toEqual(before);
  });
});
