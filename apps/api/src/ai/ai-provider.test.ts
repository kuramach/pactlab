import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { apiEnvSchema, loadConfig } from '@pactlab/config';
import { ModelProviderError, ScriptedModelTransport, type ModelTransport } from '@pactlab/ai';
import { checkAiHealth, createAiGateway, LoggedFixtureTransport, routesFrom } from './ai-provider';

const dir = mkdtempSync(join(tmpdir(), 'pactlab-ai-fixture-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the fixture AI provider (T-113)', () => {
  it('answers from scripts, and logs each request without its content', async () => {
    const log = join(dir, 'requests.jsonl');
    const transport = new LoggedFixtureTransport(log);
    const response = await transport.complete({
      modelId: 'synthetic-fixture',
      effort: 'low',
      system: 'You give a five-year forecast for each economic or sector metric you are asked about.',
      messages: [{ role: 'user', content: 'inflation: Inflation (consumer prices) (percent a year)\nSECRET-DEAL-TEXT' }],
      maxOutputTokens: 100,
    });
    expect(JSON.parse(response.text)).toMatchObject({ metrics: [{ key: 'inflation', values: [2, 2, 2, 2, 2] }] });
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ provider: 'fixture', modelId: 'synthetic-fixture', live: false });
    expect(lines[0]).not.toContain('SECRET-DEAL-TEXT');
  });

  it('is what AI_PROVIDER=fixture gives: AI on, as "synthetic", with no model', async () => {
    const { status } = await createAiGateway({ AI_PROVIDER: 'fixture', AI_FIXTURE_LOG: join(dir, 'other.jsonl') } as never);
    expect(status).toMatchObject({ enabled: true, provider: 'synthetic', region: null });
    expect(status.routes.every((route) => route.modelId === 'synthetic-fixture')).toBe(true);
  });
});

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
