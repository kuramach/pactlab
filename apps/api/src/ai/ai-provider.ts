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

/**
 * The document-AI gateway for this deployment. `AI_PROVIDER=bedrock` calls
 * Claude on Amazon Bedrock with credentials from the default chain (the task
 * role when deployed, an SSO profile on a laptop), behind retries, a circuit
 * breaker and an optional evaluated fallback model; anything else fails
 * closed with NOT_CONFIGURED, after the data policy check.
 */
export async function createAiGateway(env: ApiEnv): Promise<{ gateway: ClaudeGateway; status: AiStatusView; check: () => Promise<AiHealth | null> }> {
  if (env.AI_PROVIDER !== 'bedrock' || !env.AWS_REGION) return { gateway: new NotConfiguredClaudeGateway(), status: AI_OFF, check: async () => null };
  const routes = routesFrom(env);
  const bedrock = new BedrockModelTransport({ send: await bedrockConverseSender(env.AWS_REGION) });
  const transport = new ResilientModelTransport({ transport: bedrock, breaker: new CircuitBreaker() });
  return {
    gateway: new TransportClaudeGateway({ transport, registry: defaultPromptRegistry(), routes }),
    status: describeRoutes('bedrock', env.AWS_REGION, routes),
    // The bare transport: a boot check must not count against the breaker.
    check: () => checkAiHealth(bedrock, routes),
  };
}
