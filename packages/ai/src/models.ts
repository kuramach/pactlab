import { z } from 'zod';

/**
 * Model aliases (spec §11 "Model selection"). Application code names an
 * alias; only the gateway resolves it to a provider model ID.
 */
export const MODEL_ALIASES = ['balanced', 'deep_review', 'fast'] as const;
export const modelAliasSchema = z.enum(MODEL_ALIASES);
export type ModelAlias = z.infer<typeof modelAliasSchema>;

/** Sonnet is the default for extraction, contract analysis and document Q&A. */
export const DEFAULT_MODEL_ALIAS: ModelAlias = 'balanced';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface ModelRoute {
  /** Amazon Bedrock model ID. */
  readonly modelId: string;
  readonly effort: ReasoningEffort;
}

/**
 * Alias → Bedrock routing. The IDs are the US geo inference profiles from the
 * Bedrock model cards (2026-10-11): these models have no in-Region endpoint
 * in us-east-1, and the `us.` profiles keep requests in US Regions.
 * Deployments may override IDs through configuration (e.g. `eu.` profiles);
 * aliases never change meaning.
 */
export const DEFAULT_MODEL_ROUTES: Readonly<Record<ModelAlias, ModelRoute>> = {
  balanced: { modelId: 'us.anthropic.claude-sonnet-5-5', effort: 'medium' },
  deep_review: { modelId: 'us.anthropic.claude-opus-5-5', effort: 'high' },
  fast: { modelId: 'us.anthropic.claude-haiku-5-5', effort: 'low' },
};

/** Display names for model IDs and inference profiles, for the UI. */
export function modelLabel(modelId: string): string {
  const match = /claude-(sonnet|opus|haiku)-(\d+)-(\d+)/.exec(modelId);
  if (!match) return modelId;
  const [, family = '', major, minor] = match;
  return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}

export function resolveModel(
  alias: ModelAlias,
  overrides: Partial<Record<ModelAlias, ModelRoute>> = {},
): ModelRoute {
  return overrides[alias] ?? DEFAULT_MODEL_ROUTES[alias];
}
