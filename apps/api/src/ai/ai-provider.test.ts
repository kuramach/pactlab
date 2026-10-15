import { describe, expect, it } from 'vitest';
import { apiEnvSchema, loadConfig } from '@pactlab/config';
import { createAiGateway } from './ai-provider';

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
});
