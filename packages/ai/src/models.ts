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

/** Where a model runs (T-131). Bedrock is the default; other clouds per ADR 0034. */
export type ModelProvider = 'bedrock' | 'openai' | 'google' | 'fixture';

export interface ModelRoute {
  /** The provider's model ID (an Amazon Bedrock model or inference profile unless `provider` says otherwise). */
  readonly modelId: string;
  /** Where the model runs; Bedrock when absent. */
  readonly provider?: ModelProvider;
  readonly effort: ReasoningEffort;
  /**
   * Another Claude inference profile to try after a transient failure (T-096):
   * a second model, or the same model's other cross-region profile. Used only
   * for prompts that list it in `fallbackEvaluatedOn`. Never a non-Claude model.
   */
  readonly fallbackModelId?: string;
}

/** A fallback must be a Claude model on Bedrock. */
export function isClaudeModelId(modelId: string): boolean {
  return /^(?:[a-z]{2,6}\.)?anthropic\.claude-/.test(modelId);
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
