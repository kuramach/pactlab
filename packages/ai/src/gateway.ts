import { newId } from '@pactlab/domain';
import type { RetrievalRecord } from './retrieval';
import type { z } from 'zod';
import type { CitableSource } from './context';
import { sha256Hex } from './hash';
import { ModelProviderError, type ModelProviderErrorKind } from './bedrock';
import { detectInjection } from './injection';
import { DEFAULT_MODEL_ROUTES, isClaudeModelId, resolveModel, type ModelAlias, type ModelRoute, type ModelProvider } from './models';
import type { JobType } from './jobs';
import type { PromptDefinition, PromptRegistry } from './prompts/registry';
import type { ModelImage, ModelMessage, ModelTransport } from './transport';

/**
 * Data classifications that may never reach a model or embedding call
 * (CLAUDE.md rule 7). The gateway enforces this before any provider call.
 */
export const PROHIBITED_CLASSIFICATIONS = [
  'HR',
  'COMPENSATION',
  'PERFORMANCE',
  'NAMED_CONTRIBUTION',
] as const;

export const DATA_CLASSIFICATIONS = [
  'PUBLIC',
  'BUSINESS',
  'FINANCIAL',
  ...PROHIBITED_CLASSIFICATIONS,
] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export { modelAliasSchema, type ModelAlias } from './models';

export interface GatewayInput {
  readonly classification: DataClassification;
  readonly text: string;
  /** Template variable name, e.g. `question`. */
  readonly name?: string;
}

export interface GatewayRequest {
  readonly organizationId: string;
  readonly dealId: string;
  /** Overrides the prompt's default alias. */
  readonly modelAlias?: ModelAlias;
  /** Every input part declares its classification; unclassified input is rejected. */
  readonly inputs: readonly GatewayInput[];
  readonly sources?: readonly CitableSource[];
  /** Images read with the prompt (T-121), e.g. a rendered page; covered by the same classification check. */
  readonly images?: readonly ModelImage[];
  /** The images' data classification: required with images, checked like every other input. */
  readonly imagesClassification?: GatewayInput['classification'];
}

export type AiRunStatus = 'SUCCEEDED' | 'SCHEMA_INVALID' | 'PROVIDER_ERROR';

/**
 * Persisted per call (spec `ai_runs`): model, prompt version and hash, inputs
 * by hash only, output hash, usage and latency. Never raw content.
 */
export interface AiRunRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly taskType: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly modelAlias: ModelAlias;
  readonly resolvedModelId: string;
  /** Where the answering model runs (T-131). */
  readonly resolvedProvider: ModelProvider;
  /** The job this was (T-132): what its cost and lane are reported under. */
  readonly jobType: JobType;
  /** When a later lane answered: the model that was meant to (T-132; never silent). */
  readonly fallbackFrom: string | null;
  /** Why the earlier lane was passed over: the provider error kind. */
  readonly fallbackReason: string | null;
  readonly inputHashes: readonly string[];
  readonly outputHash: string | null;
  readonly status: AiRunStatus;
  readonly repairAttempted: boolean;
  readonly injectionSignals: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly createdAt: string;
  /** Pact-wide runs (T-139): how the pages sent were chosen; set by the caller, never by the gateway. */
  readonly retrieval?: RetrievalRecord | null;
}

export interface GatewayResponse<TOutput = unknown> {
  readonly aiRunId: string;
  readonly status: AiRunStatus;
  /**
   * Schema-validated output, or null on failure. Still untrusted until every
   * citation resolves against the supplied sources.
   */
  readonly output: TOutput | null;
  readonly run: AiRunRecord;
  /** Why a PROVIDER_ERROR happened (access, throttling, …) — never content; null otherwise. */
  readonly providerError: ModelProviderErrorKind | null;
}

/** Claude assists; it never approves findings, sets price or makes legal conclusions. */
export interface ClaudeGateway {
  invoke<TSchema extends z.ZodType>(
    prompt: PromptDefinition<TSchema>,
    request: GatewayRequest,
  ): Promise<GatewayResponse<z.infer<TSchema>>>;
}

export type GatewayPolicyCode = 'PROHIBITED_DATA' | 'NOT_CONFIGURED' | 'PROMPT_NOT_REGISTERED' | 'NO_APPROVED_MODEL';

const POLICY_MESSAGES: Record<GatewayPolicyCode, string> = {
  PROHIBITED_DATA: 'Request contains data classes that may not be sent to a model',
  NOT_CONFIGURED: 'AI gateway is not configured',
  PROMPT_NOT_REGISTERED: 'Prompt version is not registered',
  NO_APPROVED_MODEL: 'No approved model for this organization',
};

export class GatewayPolicyError extends Error {
  constructor(readonly code: GatewayPolicyCode) {
    super(POLICY_MESSAGES[code]);
    this.name = 'GatewayPolicyError';
  }
}

export function assertModelSafeInputs(request: GatewayRequest): void {
  const prohibited = new Set<string>(PROHIBITED_CLASSIFICATIONS);
  // Images carry their document's classification; an image without one is refused, like any unclassified input.
  if (request.images?.length && !request.imagesClassification) throw new GatewayPolicyError('PROHIBITED_DATA');
  const parts = [...request.inputs, ...(request.sources ?? []), ...(request.images?.length && request.imagesClassification ? [{ classification: request.imagesClassification }] : [])];
  if (parts.some((input) => prohibited.has(input.classification))) {
    throw new GatewayPolicyError('PROHIBITED_DATA');
  }
}

/** Used where no model provider is configured. Applies the data policy first. */
export class NotConfiguredClaudeGateway implements ClaudeGateway {
  async invoke<TSchema extends z.ZodType>(
    _prompt: PromptDefinition<TSchema>,
    request: GatewayRequest,
  ): Promise<GatewayResponse<z.infer<TSchema>>> {
    assertModelSafeInputs(request);
    throw new GatewayPolicyError('NOT_CONFIGURED');
  }
}

/** Accept a bare JSON object, optionally fenced. Anything else is a schema failure. */
export function parseJsonObject(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export interface ClaudeGatewayOptions {
  readonly transport: ModelTransport;
  readonly registry: PromptRegistry;
  readonly routes?: Partial<Record<ModelAlias, ModelRoute>>;
  /**
   * The route for one organization's call (T-131): its allowed, evaluated model for the alias;
   * null to use `routes`; 'BLOCKED' when its allow-list covers no model (the call is refused).
   */
  readonly routeFor?: (organizationId: string, alias: ModelAlias) => Promise<ModelRoute | null | 'BLOCKED'>;
  /**
   * Best-of-breed routing (T-132): the ordered lanes a job may run on for this organization and pact
   * (the first that answers serves). Takes precedence over `routeFor`. 'BLOCKED': none is allowed.
   */
  readonly lanesFor?: (request: { organizationId: string; dealId: string; jobType: JobType; alias: ModelAlias }) => Promise<readonly ModelRoute[] | 'BLOCKED'>;
  /** Persists the run record (spec `ai_runs`). */
  readonly onRun?: (run: AiRunRecord) => Promise<void> | void;
  readonly newId?: () => string;
  readonly now?: () => Date;
}

/**
 * Claude gateway: policy check → registered prompt → model routing →
 * structured response → schema validation with at most one repair attempt →
 * run record. Citation resolution is the caller's next step.
 */
export class TransportClaudeGateway implements ClaudeGateway {
  private readonly routes: Readonly<Record<ModelAlias, ModelRoute>>;

  constructor(private readonly options: ClaudeGatewayOptions) {
    this.routes = { ...DEFAULT_MODEL_ROUTES, ...options.routes };
  }

  async invoke<TSchema extends z.ZodType>(
    prompt: PromptDefinition<TSchema>,
    request: GatewayRequest,
  ): Promise<GatewayResponse<z.infer<TSchema>>> {
    assertModelSafeInputs(request);
    const hash = this.options.registry.hashOf(prompt);
    if (!hash) throw new GatewayPolicyError('PROMPT_NOT_REGISTERED');

    const now = this.options.now ?? (() => new Date());
    const started = now();
    const alias = request.modelAlias ?? prompt.defaultAlias;
    // The lanes this job may run on, best first (T-132); without a lane resolver, the one route of T-131.
    let lanes: readonly ModelRoute[];
    if (this.options.lanesFor) {
      const resolved = await this.options.lanesFor({ organizationId: request.organizationId, dealId: request.dealId, jobType: prompt.jobType, alias });
      if (resolved === 'BLOCKED' || resolved.length === 0) throw new GatewayPolicyError('NO_APPROVED_MODEL');
      lanes = resolved;
    } else {
      const chosen = this.options.routeFor ? await this.options.routeFor(request.organizationId, alias) : null;
      if (chosen === 'BLOCKED') throw new GatewayPolicyError('NO_APPROVED_MODEL');
      lanes = [chosen ?? resolveModel(alias, this.routes)];
    }
    let lane = 0;
    let route = lanes[0] as ModelRoute;
    let provider: ModelProvider = route.provider ?? 'bedrock';
    let fallbackFrom: string | null = null;
    let fallbackReason: string | null = null;
    const sources = request.sources ?? [];
    const user = prompt.render({ sources, inputs: request.inputs });
    const messages: ModelMessage[] = [{ role: 'user', content: user, ...(request.images?.length ? { images: request.images } : {}) }];
    const fallbackOf = (current: ModelRoute) =>
      current.fallbackModelId && isClaudeModelId(current.fallbackModelId) && prompt.fallbackEvaluatedOn?.includes(current.fallbackModelId) ? current.fallbackModelId : undefined;
    let answeredBy = route.modelId;
    let answered = false;
    // One lane at a time: a lane that is unreachable (access) or down after its own retries passes the job
    // to the next, and the run says so. Once a lane has answered, the repair attempt stays on it.
    const call = async (history: readonly ModelMessage[]) => {
      for (;;) {
        try {
          const response = await this.options.transport.complete({
            modelId: route.modelId,
            provider,
            effort: route.effort,
            system: prompt.system,
            messages: history,
            maxOutputTokens: prompt.maxOutputTokens,
            fallbackModelId: fallbackOf(route),
          });
          answeredBy = response.modelId ?? route.modelId;
          answered = true;
          return response;
        } catch (error) {
          const kind = error instanceof ModelProviderError ? error.kind : null;
          const passOn = kind === 'ACCESS' || kind === 'THROTTLED' || kind === 'UNAVAILABLE' || kind === 'DELAYED' || kind === 'UNSUPPORTED';
          if (!passOn || answered || lane + 1 >= lanes.length) throw error;
          fallbackFrom ??= route.modelId;
          fallbackReason ??= kind;
          lane += 1;
          route = lanes[lane] as ModelRoute;
          provider = route.provider ?? 'bedrock';
          answeredBy = route.modelId;
        }
      }
    };

    let status: AiRunStatus = 'SCHEMA_INVALID';
    let providerError: ModelProviderErrorKind | null = null;
    let output: z.infer<TSchema> | null = null;
    let outputHash: string | null = null;
    let repairAttempted = false;
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      let response = await call(messages);
      for (let attempt = 0; ; attempt += 1) {
        inputTokens += response.inputTokens;
        outputTokens += response.outputTokens;
        outputHash = sha256Hex(response.text);
        const parsed = prompt.outputSchema.safeParse(parseJsonObject(response.text));
        if (parsed.success) {
          status = 'SUCCEEDED';
          output = parsed.data;
          break;
        }
        if (attempt === 1) break;
        repairAttempted = true;
        // Only paths and codes go back to the model, never source content.
        const issues = parsed.error.issues
          .slice(0, 10)
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
          .join('; ');
        response = await call([
          ...messages,
          { role: 'assistant', content: response.text },
          {
            role: 'user',
            content: `Your response did not match the required JSON schema (${issues || 'not a JSON object'}). Respond again with only the corrected JSON object.`,
          },
        ]);
      }
    } catch (error) {
      status = 'PROVIDER_ERROR';
      output = null;
      providerError = error instanceof ModelProviderError ? error.kind : 'UNKNOWN';
    }

    const run: AiRunRecord = {
      id: (this.options.newId ?? newId)(),
      organizationId: request.organizationId,
      dealId: request.dealId,
      taskType: prompt.taskType,
      promptId: prompt.id,
      promptVersion: prompt.version,
      promptHash: hash,
      modelAlias: alias,
      // The model that answered: the fallback when the primary was unavailable.
      resolvedModelId: answeredBy,
      resolvedProvider: provider,
      jobType: prompt.jobType,
      fallbackFrom,
      fallbackReason,
      inputHashes: [
        ...request.inputs.map((input) => input.text),
        ...sources.map((s) => s.text),
      ].map(sha256Hex),
      outputHash,
      status,
      repairAttempted,
      injectionSignals: sources.reduce(
        (count, source) => count + detectInjection(source.text).length,
        0,
      ),
      inputTokens,
      outputTokens,
      latencyMs: now().getTime() - started.getTime(),
      createdAt: started.toISOString(),
    };
    await this.options.onRun?.(run);
    return { aiRunId: run.id, status, output, run, providerError };
  }
}
