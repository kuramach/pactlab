import type { ModelAlias, ModelRoute } from '@pactlab/ai';
import { aiModels, prismaExecutor } from '@pactlab/db';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { healthRecord, ModelRouteResolver } from './model-routes';

const routes = (balanced: string, deep: string, fast: string): Record<ModelAlias, ModelRoute> => ({
  balanced: { modelId: balanced, provider: 'bedrock', effort: 'medium' },
  deep_review: { modelId: deep, provider: 'bedrock', effort: 'high' },
  fast: { modelId: fast, provider: 'bedrock', effort: 'low' },
});
const OLD = routes('us.anthropic.claude-sonnet-4-6', 'us.anthropic.claude-opus-4-6-v1', 'us.anthropic.claude-haiku-4-5');
const NEW = routes('us.anthropic.claude-sonnet-5-5', 'us.anthropic.claude-opus-5-5', 'us.anthropic.claude-haiku-5-5');

/** A deploy's configured models go live at once (2026-11-20: a health check, not a gate). */
describe('configured models on deploy', { timeout: 60_000 }, () => {
  let db: TestDatabase;
  let operator: SyntheticTenant;
  const org = '01920000-0000-7000-8000-00000000a001';
  const routeIds = async (resolver: ModelRouteResolver) => {
    resolver.invalidate();
    const out: Record<string, string | null> = {};
    for (const alias of ['balanced', 'deep_review', 'fast'] as const) {
      const chosen = await resolver.describe(org, alias);
      out[alias] = chosen === 'BLOCKED' || chosen === null ? null : chosen.route.modelId;
    }
    return out;
  };
  const ids = (r: Record<ModelAlias, ModelRoute>) => ({ balanced: r.balanced.modelId, deep_review: r.deep_review.modelId, fast: r.fast.modelId });

  beforeAll(async () => {
    db = await startTestDatabase();
    operator = await createSyntheticTenant(db.owner, 'Pactlab Ops');
    await db.owner.query(`UPDATE users SET platform_operator = true WHERE id = $1`, [operator.userId]);
  });
  afterAll(async () => {
    await db?.stop();
  });

  it('an empty catalog takes the configured models as the defaults', async () => {
    const first = new ModelRouteResolver(db.prisma, OLD);
    await first.adopt('bedrock');
    expect(await routeIds(first)).toEqual(ids(OLD));
  });

  it('a deploy with new configured models switches every role to them at once', async () => {
    const deploy = new ModelRouteResolver(db.prisma, NEW);
    await deploy.adopt('bedrock');
    expect(await routeIds(deploy)).toEqual(ids(NEW));
    const sql = prismaExecutor(db.prisma);
    const catalog = await aiModels.list(sql, operator.userId);
    for (const id of Object.values(ids(NEW))) expect(catalog.find((m) => m.providerModelId === id)?.status).toBe('EVALUATED');
  });

  it('a deploy never switches a role an operator chose', async () => {
    const sql = prismaExecutor(db.prisma);
    const old = (await aiModels.list(sql, operator.userId)).find((m) => m.providerModelId === OLD.balanced.modelId)!;
    expect(await aiModels.setPlatformRoute(sql, operator.userId, 'balanced', old.id)).toBe(true);
    const deploy = new ModelRouteResolver(db.prisma, routes('us.anthropic.claude-sonnet-6-0', NEW.deep_review.modelId, NEW.fast.modelId));
    await deploy.adopt('bedrock');
    expect((await routeIds(deploy)).balanced).toBe(OLD.balanced.modelId);
  });

  it('a failed health check takes a model out of service; configuring it again on deploy brings it back', async () => {
    const sql = prismaExecutor(db.prisma);
    const fast = (await aiModels.list(sql, operator.userId)).find((m) => m.providerModelId === NEW.fast.modelId)!;
    await aiModels.recordEvaluation(sql, operator.userId, fast.id, healthRecord({ passed: false, latencyMs: 900, failures: ['The model could not be called (access).'] }));
    expect((await aiModels.list(sql, operator.userId)).find((m) => m.id === fast.id)?.status).toBe('ADDED');
    expect((await routeIds(new ModelRouteResolver(db.prisma, NEW))).fast).toBeNull();
    await new ModelRouteResolver(db.prisma, NEW).adopt('bedrock');
    expect((await aiModels.list(sql, operator.userId)).find((m) => m.id === fast.id)?.status).toBe('EVALUATED');
  });
});
