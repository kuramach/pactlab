import {
  BedrockModelTransport,
  CircuitBreaker,
  ModelProviderError,
  ResilientModelTransport,
  type ModelProviderErrorKind,
  type ModelTransport,
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
import { ScriptedModelTransport, type ModelRequest, type ModelResponse } from '@pactlab/ai';
import type { PrismaClient } from '@pactlab/db';
import { ModelRouteResolver, modelEvaluator, type ModelEvaluator } from './model-routes';
import { demoModelResponse } from '../demo-seed/seed';

/** What the app may say about its model provider: no credentials, no account details. */
export interface AiStatusView {
  enabled: boolean;
  provider: 'none' | 'bedrock' | 'synthetic';
  region: string | null;
  routes: { alias: ModelAlias; modelId: string; label: string }[];
}

export const AI_OFF: AiStatusView = { enabled: false, provider: 'none', region: null, routes: [] };

type RouteEnv = Pick<
  ApiEnv,
  'BEDROCK_MODEL_BALANCED' | 'BEDROCK_MODEL_DEEP_REVIEW' | 'BEDROCK_MODEL_FAST' | 'BEDROCK_FALLBACK_BALANCED' | 'BEDROCK_FALLBACK_DEEP_REVIEW' | 'BEDROCK_FALLBACK_FAST'
>;

const route = (base: ModelRoute, modelId: string | undefined, fallbackModelId: string | undefined): ModelRoute => ({
  ...base,
  ...(modelId ? { modelId } : {}),
  ...(fallbackModelId ? { fallbackModelId } : {}),
});

export function routesFrom(env: RouteEnv): Record<ModelAlias, ModelRoute> {
  return {
    balanced: route(DEFAULT_MODEL_ROUTES.balanced, env.BEDROCK_MODEL_BALANCED, env.BEDROCK_FALLBACK_BALANCED),
    deep_review: route(DEFAULT_MODEL_ROUTES.deep_review, env.BEDROCK_MODEL_DEEP_REVIEW, env.BEDROCK_FALLBACK_DEEP_REVIEW),
    fast: route(DEFAULT_MODEL_ROUTES.fast, env.BEDROCK_MODEL_FAST, env.BEDROCK_FALLBACK_FAST),
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

export type AiHealth = { healthy: true; modelId: string; latencyMs: number } | { healthy: false; modelId: string; kind: ModelProviderErrorKind; providerCode: string | null };

/**
 * One tiny synthetic call on the fast route (T-096): proves at boot that the
 * task role reaches Bedrock. No deal data; the result carries the error class
 * only. Never throws.
 */
export async function checkAiHealth(transport: ModelTransport, routes: Record<ModelAlias, ModelRoute>, now: () => number = Date.now): Promise<AiHealth> {
  const { modelId, effort } = routes.fast;
  const started = now();
  try {
    await transport.complete({
      modelId,
      effort,
      system: 'You are a connectivity check. Reply with the single word OK.',
      messages: [{ role: 'user', content: 'Synthetic check: reply OK.' }],
      maxOutputTokens: 1024,
    });
    return { healthy: true, modelId, latencyMs: now() - started };
  } catch (error) {
    return error instanceof ModelProviderError
      ? { healthy: false, modelId, kind: error.kind, providerCode: error.providerCode }
      : { healthy: false, modelId, kind: 'UNKNOWN', providerCode: null };
  }
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
 * Claude on Amazon Bedrock with credentials from the default chain (the task
 * role when deployed, an SSO profile on a laptop), behind retries, a circuit
 * breaker and an optional evaluated fallback model; `fixture` answers from
 * scripts (tests); anything else fails closed with NOT_CONFIGURED, after the
 * data policy check. The bedrock path also returns a boot health check.
 */
/** The admin console's model management (T-131): who resolves routes, how a model is evaluated, which providers can serve. */
export interface AiModelsRuntime {
  readonly resolver: ModelRouteResolver;
  readonly evaluate: ModelEvaluator;
  readonly providers: readonly ('bedrock' | 'openai' | 'google' | 'fixture')[];
}

export async function createAiGateway(
  env: ApiEnv,
  prisma?: PrismaClient,
): Promise<{ gateway: ClaudeGateway; status: AiStatusView; check: () => Promise<AiHealth | null>; models: AiModelsRuntime | null }> {
  // Local and test runs only (the config refuses it anywhere else): AI on, with no model behind it.
  if (env.AI_PROVIDER === 'fixture') {
    const resolver = prisma ? new ModelRouteResolver(prisma, FIXTURE_ROUTES) : null;
    if (resolver) await resolver.adopt('fixture');
    return {
      gateway: new TransportClaudeGateway({
        transport: new LoggedFixtureTransport(env.AI_FIXTURE_LOG ?? null),
        registry: defaultPromptRegistry(),
        routes: FIXTURE_ROUTES,
        ...(resolver ? { routeFor: (organizationId: string, alias: ModelAlias) => resolver.routeFor(organizationId, alias) } : {}),
      }),
      status: describeRoutes('synthetic', null, FIXTURE_ROUTES),
      check: async () => null,
      models: resolver ? { resolver, evaluate: modelEvaluator(null, FIXTURE_ROUTES), providers: ['fixture'] } : null,
    };
  }
  if (env.AI_PROVIDER !== 'bedrock' || !env.AWS_REGION) return { gateway: new NotConfiguredClaudeGateway(), status: AI_OFF, check: async () => null, models: null };
  const routes = routesFrom(env);
  const bedrock = new BedrockModelTransport({ send: await bedrockConverseSender(env.AWS_REGION) });
  const transport = new ResilientModelTransport({ transport: bedrock, breaker: new CircuitBreaker() });
  // The catalog (T-131): the deployment's configured models are adopted into an empty catalog, so nothing changes on deploy.
  const resolver = prisma ? new ModelRouteResolver(prisma, routes) : null;
  if (resolver) await resolver.adopt('bedrock');
  return {
    gateway: new TransportClaudeGateway({
      transport,
      registry: defaultPromptRegistry(),
      routes,
      ...(resolver ? { routeFor: (organizationId: string, alias: ModelAlias) => resolver.routeFor(organizationId, alias) } : {}),
    }),
    status: describeRoutes('bedrock', env.AWS_REGION, routes),
    // The bare transport: a boot check must not count against the breaker.
    check: () => checkAiHealth(bedrock, routes),
    // Evaluations go through the bare transport too: a model under test must not trip the breaker for live traffic.
    models: resolver ? { resolver, evaluate: modelEvaluator(bedrock, routes), providers: ['bedrock'] } : null,
  };
}
