import type { ModelAlias, ModelProvider, ReasoningEffort } from './models';

/**
 * Best-of-breed routing (T-132): every AI job type, and the ordered chain of lanes it may run on.
 * The first eligible lane serves; the rest are its fallbacks. These are DEFAULTS, not doctrine:
 * the admin console (per platform and organization), `MODEL_JOB_<JOB>` and the evaluation gate
 * re-rank them without a rebuild. Evidence behind the defaults (2026 independent benchmarks) is in
 * the T-132 task file; nothing here is a claim the product makes.
 *
 * A lane is either
 * - `claude`: the deployment's Claude model for an alias (Bedrock or the Anthropic API, whatever the
 *   deployment and the console route that alias to), or
 * - `model`: a specific model at a provider outside the Claude lane. It serves only when that
 *   provider is connected, its data terms are recorded, and the model is EVALUATED in the catalog
 *   (and, for an organization with an allow-list, allowed). Otherwise the chain moves on.
 * `tier` lets a per-pact cost ceiling move a job to its economy lanes first.
 *
 * On a deployment with only its Claude provider (every environment until other keys and terms are
 * set), each job's Claude lane is the alias its prompts already run on, so nothing changes there.
 */
export const JOB_TYPES = ['deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type Lane =
  | { readonly kind: 'claude'; readonly alias: ModelAlias; readonly tier: 'flagship' | 'economy' }
  | { readonly kind: 'model'; readonly provider: Exclude<ModelProvider, 'fixture'>; readonly modelId: string; readonly effort: ReasoningEffort; readonly tier: 'flagship' | 'economy' };

export interface JobDefinition {
  readonly label: string;
  readonly lanes: readonly Lane[];
}

/** Model IDs as the providers' official SDKs list them (openai, @google/genai); verify again when enabling a lane. */
const GPT_5_5 = 'gpt-5.5';
const GEMINI_PRO = 'gemini-3.1-pro-preview';
const GEMINI_FLASH = 'gemini-3.8-flash';

export const JOB_MODEL_MAP: Readonly<Record<JobType, JobDefinition>> = {
  deep_review: {
    label: 'Deep review of agreements',
    lanes: [
      { kind: 'claude', alias: 'deep_review', tier: 'flagship' },
      { kind: 'claude', alias: 'balanced', tier: 'economy' },
    ],
  },
  contract_scrub: {
    label: 'Consistency checks (defined terms, cross-references, party names)',
    lanes: [
      { kind: 'model', provider: 'openai', modelId: GPT_5_5, effort: 'high', tier: 'flagship' },
      { kind: 'claude', alias: 'deep_review', tier: 'flagship' },
      { kind: 'claude', alias: 'balanced', tier: 'economy' },
    ],
  },
  extraction: {
    label: 'Extraction (contract fields, financial lines)',
    lanes: [
      { kind: 'model', provider: 'google', modelId: GEMINI_PRO, effort: 'medium', tier: 'economy' },
      { kind: 'claude', alias: 'balanced', tier: 'flagship' },
    ],
  },
  classification: {
    label: 'Classification and triage',
    lanes: [
      { kind: 'model', provider: 'google', modelId: GEMINI_FLASH, effort: 'low', tier: 'economy' },
      // The classify prompt is evaluated on the balanced Claude model; a Haiku-class lane is a console route once evaluated.
      { kind: 'claude', alias: 'balanced', tier: 'flagship' },
    ],
  },
  document_qa: {
    label: 'Questions and drafting over documents',
    lanes: [
      { kind: 'model', provider: 'google', modelId: GEMINI_PRO, effort: 'medium', tier: 'economy' },
      { kind: 'claude', alias: 'balanced', tier: 'flagship' },
    ],
  },
  vision: {
    label: 'Documents that arrive as images (scans, charts, image tables)',
    lanes: [
      { kind: 'model', provider: 'google', modelId: GEMINI_PRO, effort: 'medium', tier: 'economy' },
      { kind: 'claude', alias: 'balanced', tier: 'flagship' },
    ],
  },
};

/** `MODEL_JOB_<JOB>` values: `provider:modelId`, e.g. `anthropic:claude-opus-5-5` or `openai:gpt-5.5`. */
export function parseJobOverride(value: string | undefined): { provider: Exclude<ModelProvider, 'fixture'>; modelId: string } | null {
  const match = /^(bedrock|anthropic|openai|google):([A-Za-z0-9][A-Za-z0-9._:/-]{1,199})$/.exec(value?.trim() ?? '');
  return match ? { provider: match[1] as Exclude<ModelProvider, 'fixture'>, modelId: match[2] as string } : null;
}
