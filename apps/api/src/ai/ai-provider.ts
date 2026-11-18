import {
  AnthropicModelTransport,
  DEFAULT_ANTHROPIC_ROUTES,
  GoogleModelTransport,
  OpenAIModelTransport,
  ProviderRouterTransport,
  type ModelProvider,
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
  provider: 'none' | 'bedrock' | 'anthropic' | 'synthetic';
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

/** What best-of-breed routing reads from the deployment (T-132): connected providers, per-job overrides, the cost ceiling. */
function routing(env: ApiEnv, providers: readonly ModelProvider[]) {
  return {
    providers,
    jobOverrides: {
      deep_review: env.MODEL_JOB_DEEP_REVIEW,
      contract_scrub: env.MODEL_JOB_CONTRACT_SCRUB,
      extraction: env.MODEL_JOB_EXTRACTION,
      classification: env.MODEL_JOB_CLASSIFICATION,
      document_qa: env.MODEL_JOB_DOCUMENT_QA,
      vision: env.MODEL_JOB_VISION,
    },
    ceilingUsd: env.AI_DEAL_COST_CEILING_USD ?? null,
  };
}

/** Claude through the direct Anthropic API (T-132), per alias, with the deployment's overrides. */
export function anthropicRoutesFrom(env: Pick<ApiEnv, 'ANTHROPIC_MODEL_BALANCED' | 'ANTHROPIC_MODEL_DEEP_REVIEW' | 'ANTHROPIC_MODEL_FAST'>): Record<ModelAlias, ModelRoute> {
  const pick = (alias: ModelAlias, modelId: string | undefined) => ({ ...DEFAULT_ANTHROPIC_ROUTES[alias], ...(modelId ? { modelId } : {}) });
  return { balanced: pick('balanced', env.ANTHROPIC_MODEL_BALANCED), deep_review: pick('deep_review', env.ANTHROPIC_MODEL_DEEP_REVIEW), fast: pick('fast', env.ANTHROPIC_MODEL_FAST) };
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
  readonly providers: readonly ModelProvider[];
}

export async function createAiGateway(
  env: ApiEnv,
  prisma?: PrismaClient,
): Promise<{ gateway: ClaudeGateway; status: AiStatusView; check: () => Promise<AiHealth | null>; models: AiModelsRuntime | null }> {
  // Local and test runs only (the config refuses it anywhere else): AI on, with no model behind it.
  if (env.AI_PROVIDER === 'fixture') {
    const resolver = prisma ? new ModelRouteResolver(prisma, FIXTURE_ROUTES, Date.now, routing(env, ['fixture'])) : null;
    if (resolver) await resolver.adopt('fixture');
    return {
      gateway: new TransportClaudeGateway({
        transport: new LoggedFixtureTransport(env.AI_FIXTURE_LOG ?? null),
        registry: defaultPromptRegistry(),
        routes: FIXTURE_ROUTES,
        ...(resolver ? { lanesFor: (request: Parameters<ModelRouteResolver['lanesFor']>[0]) => resolver.lanesFor(request) } : {}),
      }),
      status: describeRoutes('synthetic', null, FIXTURE_ROUTES),
      check: async () => null,
      models: resolver ? { resolver, evaluate: modelEvaluator(null, FIXTURE_ROUTES), providers: ['fixture'] } : null,
    };
  }
  // The deployment's default provider: Claude on Bedrock, or Claude through the direct Anthropic API
  // (T-132, while Bedrock is unavailable). Without what it needs (a Region, a key), AI is off, never broken.
  const primary = env.AI_PROVIDER === 'bedrock' && env.AWS_REGION ? 'bedrock' : env.AI_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY ? 'anthropic' : null;
  if (!primary) return { gateway: new NotConfiguredClaudeGateway(), status: AI_OFF, check: async () => null, models: null };
  const routes = primary === 'bedrock' ? routesFrom(env) : anthropicRoutesFrom(env);
  const bedrock = primary === 'bedrock' && env.AWS_REGION ? new BedrockModelTransport({ send: await bedrockConverseSender(env.AWS_REGION) }) : null;
  // Other lanes (T-131, T-132, ADR 0034), each connected only when its key is set. Every provider has its
  // own retries and breaker, so one provider's outage never pauses another.
  const bare: Partial<Record<ModelProvider, ModelTransport>> = {
    ...(bedrock ? { bedrock } : {}),
    ...(env.ANTHROPIC_API_KEY ? { anthropic: new AnthropicModelTransport({ apiKey: async () => env.ANTHROPIC_API_KEY as string }) } : {}),
    ...(env.OPENAI_API_KEY ? { openai: new OpenAIModelTransport({ apiKey: async () => env.OPENAI_API_KEY as string }) } : {}),
    ...(env.GOOGLE_API_KEY ? { google: new GoogleModelTransport({ apiKey: async () => env.GOOGLE_API_KEY as string }) } : {}),
  };
  const transport = new ProviderRouterTransport(
    Object.fromEntries(Object.entries(bare).map(([provider, inner]) => [provider, new ResilientModelTransport({ transport: inner as ModelTransport, breaker: new CircuitBreaker() })])),
  );
  // The catalog (T-131): the deployment's configured models are adopted into an empty catalog, so nothing changes on deploy.
  const resolver = prisma ? new ModelRouteResolver(prisma, routes, Date.now, routing(env, transport.providers)) : null;
  if (resolver) await resolver.adopt(primary);
  return {
    gateway: new TransportClaudeGateway({
      transport,
      registry: defaultPromptRegistry(),
      routes,
      // Best-of-breed routing (T-132): each job's lanes, best first, with fallback along the chain.
      ...(resolver ? { lanesFor: (request: Parameters<ModelRouteResolver['lanesFor']>[0]) => resolver.lanesFor(request) } : {}),
    }),
    status: describeRoutes(primary, primary === 'bedrock' ? (env.AWS_REGION ?? null) : null, routes),
    // The bare transport: a boot check must not count against the breaker.
    check: () => checkAiHealth(bare[primary] as ModelTransport, routes),
    // Evaluations go through the bare transport too: a model under test must not trip the breaker for live traffic.
    models: resolver ? { resolver, evaluate: modelEvaluator(new ProviderRouterTransport(bare), routes), providers: transport.providers } : null,
  };
}
