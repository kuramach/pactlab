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
 * Alias → Bedrock model routing. `fast` maps to Sonnet at low effort until
 * Haiku 5.5 ships on Bedrock. Deployments may override IDs through
 * configuration; aliases never change meaning.
 */
export const DEFAULT_MODEL_ROUTES: Readonly<Record<ModelAlias, ModelRoute>> = {
  balanced: { modelId: 'anthropic.claude-sonnet-5-5', effort: 'medium' },
  deep_review: { modelId: 'anthropic.claude-opus-5-5', effort: 'high' },
  fast: { modelId: 'anthropic.claude-sonnet-5-5', effort: 'low' },
};

export function resolveModel(
  alias: ModelAlias,
  overrides: Partial<Record<ModelAlias, ModelRoute>> = {},
): ModelRoute {
  return overrides[alias] ?? DEFAULT_MODEL_ROUTES[alias];
}
