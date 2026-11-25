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

/**
 * The default chain per job, from the model scorecard (docs/model-scorecard.md, Nov 21, 2026): public
 * benchmark priors per job, then cost per task. A lane serves only if its model is reachable, its data terms
 * are recorded and its health check passed; otherwise the next lane serves. Claude lanes are the roles:
 * deep_review = Opus 5.5, balanced = Sonnet 5.5, fast = Haiku 5.5 (the configured Bedrock models).
 */
export const JOB_MODEL_MAP: Readonly<Record<JobType, JobDefinition>> = {
  // Opus 5.5 leads every single-pass legal board (scorecard §1).
  deep_review: {
    label: 'Deep review of agreements',
    lanes: [
      { kind: 'claude', alias: 'deep_review', tier: 'flagship' },
      { kind: 'claude', alias: 'balanced', tier: 'economy' },
    ],
  },
  // ContractScrub, the only direct study: GPT-5.5 75%, Gemini 3.1 Pro 74% (§2).
  contract_scrub: {
    label: 'Consistency checks (defined terms, cross-references, party names)',
    lanes: [
      { kind: 'model', provider: 'openai', modelId: GPT_5_5, effort: 'high', tier: 'flagship' },
      { kind: 'model', provider: 'google', modelId: GEMINI_PRO, effort: 'medium', tier: 'flagship' },
      { kind: 'claude', alias: 'deep_review', tier: 'flagship' },
      { kind: 'claude', alias: 'balanced', tier: 'economy' },
    ],
  },
  // Schema-bound fields route on cost: Haiku 5.5 56.7% at $0.20/task (beats Sonnet 5.5's 40%); Opus 5.5 76.7% at $2.71 as the quality fallback (§3).
  extraction: {
    label: 'Extraction (contract fields, financial lines)',
    lanes: [
      { kind: 'claude', alias: 'fast', tier: 'economy' },
      { kind: 'model', provider: 'google', modelId: GEMINI_PRO, effort: 'medium', tier: 'economy' },
      { kind: 'claude', alias: 'deep_review', tier: 'flagship' },
    ],
  },
  // No current public board either way: route on cost and latency, never Opus-class (§4).
  classification: {
    label: 'Classification and triage',
    lanes: [
      { kind: 'model', provider: 'google', modelId: GEMINI_FLASH, effort: 'low', tier: 'economy' },
      { kind: 'claude', alias: 'fast', tier: 'economy' },
      { kind: 'claude', alias: 'balanced', tier: 'flagship' },
    ],
  },
  // The Gemini line leads the document boards; Opus 5.5 for single-pass Q&A over retrieved context (§5).
  document_qa: {
    label: 'Questions and drafting over documents',
    lanes: [
      { kind: 'model', provider: 'google', modelId: GEMINI_PRO, effort: 'medium', tier: 'economy' },
      { kind: 'claude', alias: 'deep_review', tier: 'flagship' },
      { kind: 'claude', alias: 'balanced', tier: 'economy' },
    ],
  },
  // Keep Gemini 3.1 Pro until a successor passes; Opus 5.5 scores 80.6 on the multimodal board (§6).
  vision: {
    label: 'Documents that arrive as images (scans, charts, image tables)',
    lanes: [
      { kind: 'model', provider: 'google', modelId: GEMINI_PRO, effort: 'medium', tier: 'economy' },
      { kind: 'claude', alias: 'deep_review', tier: 'flagship' },
      { kind: 'claude', alias: 'balanced', tier: 'economy' },
    ],
  },
};

/** `MODEL_JOB_<JOB>` values: `provider:modelId`, e.g. `anthropic:claude-opus-5-5` or `openai:gpt-5.5`. */
export function parseJobOverride(value: string | undefined): { provider: Exclude<ModelProvider, 'fixture'>; modelId: string } | null {
  const match = /^(bedrock|anthropic|openai|google):([A-Za-z0-9][A-Za-z0-9._:/-]{1,199})$/.exec(value?.trim() ?? '');
  return match ? { provider: match[1] as Exclude<ModelProvider, 'fixture'>, modelId: match[2] as string } : null;
}
