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
import { demoModelResponse, seedDemo } from './seed';

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
      { name: 'Base case — ARR multiple, risk-adjusted', status: 'DRAFT', runs: 1 },
      { name: 'Downside — DCF', status: 'DRAFT', runs: 1 },
      { name: 'Early look — DCF', status: 'DRAFT', runs: 0 },
    ]);
  });

  it('uploads contracts with cited AI drafts recorded as synthetic, one accepted by the reviewer', async () => {
    const docs = await rows(`SELECT count(*)::int AS n FROM documents WHERE organization_id = $1`, [CHARLIE]);
    expect(docs[0]!['n']).toBe(4);
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

  it('changes nothing when run again', async () => {
    const count = async () =>
      rows(
        `SELECT (SELECT count(*) FROM valuation_scenarios)::int AS s, (SELECT count(*) FROM documents)::int AS d,
                (SELECT count(*) FROM finding_reviews)::int AS r, (SELECT count(*) FROM document_findings)::int AS f`,
      );
    const before = await count();
    await seedDemo(app, db.prisma);
    expect(await count()).toEqual(before);
  });
});
