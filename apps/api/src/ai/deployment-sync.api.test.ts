import { runDocumentEvals } from '@pactlab/ai/evals';
import type { ModelAlias, ModelRoute } from '@pactlab/ai';
import { aiModels, prismaExecutor } from '@pactlab/db';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModelRouteResolver, type ModelEvaluator } from './model-routes';

const routes = (balanced: string, deep: string, fast: string): Record<ModelAlias, ModelRoute> => ({
  balanced: { modelId: balanced, provider: 'bedrock', effort: 'medium' },
  deep_review: { modelId: deep, provider: 'bedrock', effort: 'high' },
  fast: { modelId: fast, provider: 'bedrock', effort: 'low' },
});
const OLD = routes('us.anthropic.claude-sonnet-4-6', 'us.anthropic.claude-opus-4-6-v1', 'us.anthropic.claude-haiku-4-5');
const NEW = routes('us.anthropic.claude-sonnet-5-5', 'us.anthropic.claude-opus-5-5', 'us.anthropic.claude-haiku-5-5');

/** A deploy's configured models go live on their own: synced, evaluated, switched in (Kumar, 2026-11-20). */
describe('deployment model rollout', { timeout: 60_000 }, () => {
  let db: TestDatabase;
  let operator: SyntheticTenant;
  const org = '01920000-0000-7000-8000-00000000a001';
  // Passing: the recorded golden set; failing: the model cannot be reached.
  const evaluate =
    (failing: readonly string[], calls: string[] = []): ModelEvaluator =>
    async (model) => {
      calls.push(model.providerModelId);
      if (failing.includes(model.providerModelId)) throw Object.assign(new Error('access'), { name: 'AccessDeniedException' });
      return runDocumentEvals();
    };
  const routeIds = async (resolver: ModelRouteResolver) => {
    resolver.invalidate();
    const out: Record<string, string | null> = {};
    for (const alias of ['balanced', 'deep_review', 'fast'] as const) {
      const chosen = await resolver.describe(org, alias);
      out[alias] = chosen === 'BLOCKED' || chosen === null ? null : chosen.route.modelId;
    }
    return out;
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    operator = await createSyntheticTenant(db.owner, 'Pactlab Ops');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operator.userId]);
  });
  afterAll(async () => {
    await db?.stop();
  });

  it('an empty catalog adopts the configured models as serving, as before', async () => {
    const first = new ModelRouteResolver(db.prisma, OLD);
    expect(await first.adopt('bedrock')).toBe(0);
    expect(await routeIds(first)).toEqual({ balanced: OLD.balanced.modelId, deep_review: OLD.deep_review.modelId, fast: OLD.fast.modelId });
  });

  it('a deploy with new models adds them, evaluates them after boot, and switches in those that pass', async () => {
    const deploy = new ModelRouteResolver(db.prisma, NEW);
    expect(await deploy.adopt('bedrock')).toBe(3);
    // Until evaluated, the old models keep serving.
    expect(await routeIds(deploy)).toEqual({ balanced: OLD.balanced.modelId, deep_review: OLD.deep_review.modelId, fast: OLD.fast.modelId });
    const reports: { label: string; passed: boolean; switched: readonly string[] }[] = [];
    await deploy.rollOut(evaluate([NEW.fast.modelId]), (outcome) => reports.push(outcome));
    expect(reports.map((r) => [r.label, r.passed, [...r.switched]])).toEqual([
      ['Claude Haiku 5.5', false, []],
      ['Claude Opus 5.5', true, ['deep_review']],
      ['Claude Sonnet 5.5', true, ['balanced']],
    ]);
    // Haiku failed: the old fast model keeps serving.
    expect(await routeIds(deploy)).toEqual({ balanced: NEW.balanced.modelId, deep_review: NEW.deep_review.modelId, fast: OLD.fast.modelId });
    const audit = (await db.owner.query(`SELECT action FROM audit_events WHERE action LIKE 'operator.system.%' ORDER BY action`)) as { rows: { action: string }[] };
    expect(new Set(audit.rows.map((r) => r.action))).toEqual(new Set(['operator.system.ai_model_evaluation_started', 'operator.system.ai_model_evaluation_passed', 'operator.system.ai_model_evaluation_failed', 'operator.system.ai_route_switched']));
  });

  it('the next boot retries the failed model, and never evaluates the same model twice at once', async () => {
    const calls: string[] = [];
    const a = new ModelRouteResolver(db.prisma, NEW);
    const b = new ModelRouteResolver(db.prisma, NEW);
    expect(await a.adopt('bedrock')).toBe(1);
    expect(await b.adopt('bedrock')).toBe(1);
    await Promise.all([a.rollOut(evaluate([], calls), () => undefined), b.rollOut(evaluate([], calls), () => undefined)]);
    expect(calls).toEqual([NEW.fast.modelId]);
    expect((await routeIds(a)).fast).toBe(NEW.fast.modelId);
  });

  it('a deploy never switches a route an operator chose', async () => {
    const sql = prismaExecutor(db.prisma);
    const old = (await aiModels.list(sql, operator.userId)).find((m) => m.providerModelId === OLD.balanced.modelId)!;
    expect(await aiModels.setPlatformRoute(sql, operator.userId, 'balanced', old.id)).toBe(true);
    const next = routes('us.anthropic.claude-sonnet-6-0', NEW.deep_review.modelId, NEW.fast.modelId);
    const deploy = new ModelRouteResolver(db.prisma, next);
    await deploy.adopt('bedrock');
    const reports: { switched: readonly string[] }[] = [];
    await deploy.rollOut(evaluate([]), (outcome) => reports.push(outcome));
    expect(reports).toEqual([expect.objectContaining({ passed: true, switched: [] })]);
    expect((await routeIds(deploy)).balanced).toBe(OLD.balanced.modelId);
  });

  it('a failed evaluation takes a serving model out of service; its role falls back to the configured model', async () => {
    const sql = prismaExecutor(db.prisma);
    const fast = (await aiModels.list(sql, operator.userId)).find((m) => m.providerModelId === NEW.fast.modelId)!;
    await aiModels.recordEvaluation(sql, operator.userId, fast.id, { passed: false, goldenPassed: 0, goldenTotal: 13, probesBlocked: 7, probesTotal: 7, citationRecall: 0, citationPrecision: 1, promptHashes: {}, ranAt: new Date().toISOString() });
    expect((await aiModels.list(sql, operator.userId)).find((m) => m.id === fast.id)?.status).toBe('ADDED');
    const resolver = new ModelRouteResolver(db.prisma, NEW);
    // No route resolves: the gateway uses the deployment's configured model for the role.
    expect((await routeIds(resolver)).fast).toBeNull();
  });
});
