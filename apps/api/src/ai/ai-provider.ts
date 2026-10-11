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

/**
 * The document-AI gateway for this deployment. `AI_PROVIDER=bedrock` calls
 * Claude on Amazon Bedrock with SSO credentials from the default chain;
 * anything else fails closed with NOT_CONFIGURED, after the data policy check.
 */
export async function createAiGateway(env: ApiEnv): Promise<{ gateway: ClaudeGateway; status: AiStatusView }> {
  if (env.AI_PROVIDER !== 'bedrock' || !env.AWS_REGION) return { gateway: new NotConfiguredClaudeGateway(), status: AI_OFF };
  const routes = routesFrom(env);
  const transport = new BedrockModelTransport({ send: await bedrockConverseSender(env.AWS_REGION) });
  return {
    gateway: new TransportClaudeGateway({ transport, registry: defaultPromptRegistry(), routes }),
    status: describeRoutes('bedrock', env.AWS_REGION, routes),
  };
}
