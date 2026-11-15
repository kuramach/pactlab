import { describe, expect, it } from 'vitest';
import { apiEnvSchema, loadConfig } from '@pactlab/config';
import { ModelProviderError, ScriptedModelTransport, type ModelTransport } from '@pactlab/ai';
import { checkAiHealth, createAiGateway, routesFrom } from './ai-provider';

const env = (extra: Record<string, string>) =>
  loadConfig(apiEnvSchema, {
    APP_ENV: 'test',
    APP_WEB_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://pactlab_api:example@localhost:5432/pactlab',
    AUTH_TOKEN_SECRET: 'x'.repeat(32),
    ...extra,
  });

describe('createAiGateway', () => {
  it('keeps AI off unless Bedrock is chosen', async () => {
    const { status } = await createAiGateway(env({}));
    expect(status).toEqual({ enabled: false, provider: 'none', region: null, routes: [] });
  });

  it('routes aliases to the US geo inference profiles, with overrides, without calling Bedrock', async () => {
    const { status } = await createAiGateway(env({ AI_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1', BEDROCK_MODEL_FAST: 'eu.anthropic.claude-haiku-5-5' }));
    expect(status).toEqual({
      enabled: true,
      provider: 'bedrock',
      region: 'us-east-1',
      routes: [
        { alias: 'balanced', modelId: 'us.anthropic.claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
        { alias: 'deep_review', modelId: 'us.anthropic.claude-opus-5-5', label: 'Claude Opus 5.5' },
        { alias: 'fast', modelId: 'eu.anthropic.claude-haiku-5-5', label: 'Claude Haiku 5.5' },
      ],
    });
  });

  it('takes an evaluated fallback per alias from the environment, Claude models only (T-096)', () => {
    const routes = routesFrom(env({ AI_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1', BEDROCK_FALLBACK_BALANCED: 'us.anthropic.claude-opus-5-5' }));
    expect(routes.balanced).toMatchObject({ modelId: 'us.anthropic.claude-sonnet-5-5', fallbackModelId: 'us.anthropic.claude-opus-5-5' });
    expect(routes.fast.fallbackModelId).toBeUndefined();
    expect(() => env({ AI_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1', BEDROCK_FALLBACK_FAST: 'amazon.nova-pro-v1:0' })).toThrow(/BEDROCK_FALLBACK_FAST/);
  });
});

describe('checkAiHealth (startup check, T-096)', () => {
  const routes = routesFrom({ BEDROCK_MODEL_BALANCED: undefined, BEDROCK_MODEL_DEEP_REVIEW: undefined, BEDROCK_MODEL_FAST: undefined, BEDROCK_FALLBACK_BALANCED: undefined, BEDROCK_FALLBACK_DEEP_REVIEW: undefined, BEDROCK_FALLBACK_FAST: undefined });

  it('reports healthy after one synthetic call on the fast model', async () => {
    const transport = new ScriptedModelTransport(() => 'OK');
    let at = 0;
    const health = await checkAiHealth(transport, routes, () => (at += 40));
    expect(health).toEqual({ healthy: true, modelId: 'us.anthropic.claude-haiku-5-5', latencyMs: 40 });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.messages[0]?.content).toMatch(/^Synthetic check/);
  });

  it('reports unhealthy with the error class only, and never throws', async () => {
    const refused: ModelTransport = { complete: async () => Promise.reject(new ModelProviderError('ACCESS', 'AccessDeniedException')) };
    expect(await checkAiHealth(refused, routes)).toEqual({ healthy: false, modelId: 'us.anthropic.claude-haiku-5-5', kind: 'ACCESS', providerCode: 'AccessDeniedException' });
    const broken: ModelTransport = { complete: async () => Promise.reject(new Error('secret detail')) };
    expect(await checkAiHealth(broken, routes)).toEqual({ healthy: false, modelId: 'us.anthropic.claude-haiku-5-5', kind: 'UNKNOWN', providerCode: null });
  });
});
