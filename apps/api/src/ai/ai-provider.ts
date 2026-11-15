import {
  BedrockModelTransport,
  bedrockConverseSender,
  DEFAULT_MODEL_ROUTES,
  defaultPromptRegistry,
  modelLabel,
  NotConfiguredClaudeGateway,
  TransportClaudeGateway,
  type ClaudeGateway,
  type ModelAlias,
  type ModelRoute,
} from '@pactlab/ai';
import type { ApiEnv } from '@pactlab/config';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { ScriptedModelTransport, type ModelRequest, type ModelResponse, type ModelTransport } from '@pactlab/ai';
import { demoModelResponse } from '../demo-seed/seed';

/** What the app may say about its model provider: no credentials, no account details. */
export interface AiStatusView {
  enabled: boolean;
  provider: 'none' | 'bedrock' | 'synthetic';
  region: string | null;
  routes: { alias: ModelAlias; modelId: string; label: string }[];
}

export const AI_OFF: AiStatusView = { enabled: false, provider: 'none', region: null, routes: [] };

export function routesFrom(env: Pick<ApiEnv, 'BEDROCK_MODEL_BALANCED' | 'BEDROCK_MODEL_DEEP_REVIEW' | 'BEDROCK_MODEL_FAST'>): Record<ModelAlias, ModelRoute> {
  return {
    balanced: { ...DEFAULT_MODEL_ROUTES.balanced, ...(env.BEDROCK_MODEL_BALANCED ? { modelId: env.BEDROCK_MODEL_BALANCED } : {}) },
    deep_review: { ...DEFAULT_MODEL_ROUTES.deep_review, ...(env.BEDROCK_MODEL_DEEP_REVIEW ? { modelId: env.BEDROCK_MODEL_DEEP_REVIEW } : {}) },
    fast: { ...DEFAULT_MODEL_ROUTES.fast, ...(env.BEDROCK_MODEL_FAST ? { modelId: env.BEDROCK_MODEL_FAST } : {}) },
  };
}

export function describeRoutes(provider: AiStatusView['provider'], region: string | null, routes: Record<ModelAlias, ModelRoute>): AiStatusView {
  return {
    enabled: true,
    provider,
    region,
    routes: (Object.keys(routes) as ModelAlias[]).map((alias) => ({ alias, modelId: routes[alias].modelId, label: modelLabel(routes[alias].modelId) })),
  };
}

/** Synthetic routes: what the fixture provider records runs under, never a real model id. */
const SYNTHETIC_ROUTE: ModelRoute = { modelId: 'synthetic-fixture', effort: 'low' };
export const FIXTURE_ROUTES: Record<ModelAlias, ModelRoute> = { balanced: SYNTHETIC_ROUTE, deep_review: SYNTHETIC_ROUTE, fast: SYNTHETIC_ROUTE };

/**
 * The fixture provider (T-113): scripted responses (the ones the seed and API tests use), no network,
 * and one JSON line per request in a log, so a test run can prove it made no live model call.
 * Logged: the time, the model id (always `synthetic-fixture`) and a hash of the system prompt. Never the content.
 */
export class LoggedFixtureTransport implements ModelTransport {
  private readonly inner = new ScriptedModelTransport((request) => demoModelResponse(request));

  constructor(private readonly logPath: string | null) {
    if (logPath) mkdirSync(dirname(logPath), { recursive: true });
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.inner.complete(request);
    if (this.logPath) {
      const prompt = createHash('sha256').update(request.system).digest('hex').slice(0, 12);
      appendFileSync(this.logPath, `${JSON.stringify({ at: new Date().toISOString(), provider: 'fixture', modelId: request.modelId, prompt, live: false })}\n`);
    }
    return response;
  }
}

/**
 * The document-AI gateway for this deployment. `AI_PROVIDER=bedrock` calls
 * Claude on Amazon Bedrock with SSO credentials from the default chain;
 * `fixture` answers from scripts (tests); anything else fails closed with NOT_CONFIGURED, after the data policy check.
 */
export async function createAiGateway(env: ApiEnv): Promise<{ gateway: ClaudeGateway; status: AiStatusView }> {
  // Local and test runs only (the config refuses it anywhere else): AI on, with no model behind it.
  if (env.AI_PROVIDER === 'fixture') {
    return {
      gateway: new TransportClaudeGateway({ transport: new LoggedFixtureTransport(env.AI_FIXTURE_LOG ?? null), registry: defaultPromptRegistry(), routes: FIXTURE_ROUTES }),
      status: describeRoutes('synthetic', null, FIXTURE_ROUTES),
    };
  }
  if (env.AI_PROVIDER !== 'bedrock' || !env.AWS_REGION) return { gateway: new NotConfiguredClaudeGateway(), status: AI_OFF };
  const routes = routesFrom(env);
  const transport = new BedrockModelTransport({ send: await bedrockConverseSender(env.AWS_REGION) });
  return {
    gateway: new TransportClaudeGateway({ transport, registry: defaultPromptRegistry(), routes }),
    status: describeRoutes('bedrock', env.AWS_REGION, routes),
  };
}
