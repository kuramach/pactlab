import type { ConverseCommandInput, ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import type { ModelRequest, ModelResponse, ModelTransport } from './transport';

/** Why a provider call failed, without any request or response content. */
/** UNSUPPORTED (T-121): the provider's transport cannot send what the call needs (e.g. images); the next lane is tried. */
export type ModelProviderErrorKind = 'ACCESS' | 'THROTTLED' | 'UNAVAILABLE' | 'DELAYED' | 'INVALID_REQUEST' | 'EMPTY_RESPONSE' | 'UNSUPPORTED' | 'UNKNOWN';

const HINTS: Record<ModelProviderErrorKind, string> = {
  ACCESS: 'Bedrock refused access: sign in (aws sso login) and enable the Claude models in the Bedrock console',
  THROTTLED: 'Bedrock is throttling requests; try again shortly',
  UNAVAILABLE: 'Bedrock is temporarily unavailable or timed out',
  DELAYED: 'AI is delayed after repeated provider failures; calls resume shortly',
  INVALID_REQUEST: 'Bedrock rejected the request (model ID or parameters)',
  EMPTY_RESPONSE: 'Bedrock returned no text',
  UNSUPPORTED: 'This provider cannot take this kind of input (images); another model is used',
  UNKNOWN: 'The model call failed',
};

export class ModelProviderError extends Error {
  constructor(
    readonly kind: ModelProviderErrorKind,
    /** The provider's error name only (e.g. `AccessDeniedException`), never its message. */
    readonly providerCode: string | null,
  ) {
    super(HINTS[kind]);
    this.name = 'ModelProviderError';
  }
}

/** The API's stable reason code for a failed model call (never provider text). */
export function aiProblemCode(kind: ModelProviderErrorKind | null): 'AI_ACCESS' | 'AI_THROTTLED' | 'AI_DELAYED' | 'AI_UNAVAILABLE' {
  return kind === 'ACCESS' ? 'AI_ACCESS' : kind === 'THROTTLED' ? 'AI_THROTTLED' : kind === 'DELAYED' ? 'AI_DELAYED' : 'AI_UNAVAILABLE';
}

/** The one Bedrock Runtime call the transport makes; injected so tests never reach the network. */
export type ConverseSender = (input: ConverseCommandInput, options: { abortSignal: AbortSignal }) => Promise<ConverseCommandOutput>;

const RETRYABLE = new Set<ModelProviderErrorKind>(['THROTTLED', 'UNAVAILABLE']);

/** Throttling and outages: worth a retry, a fallback model, and a count against the circuit breaker. */
export function isTransient(error: unknown): boolean {
  return error instanceof ModelProviderError && RETRYABLE.has(error.kind);
}

function classify(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) return error;
  const name = error instanceof Error ? error.name : null;
  switch (name) {
    case 'AccessDeniedException':
    case 'UnrecognizedClientException':
    case 'ExpiredTokenException':
    case 'CredentialsProviderError':
      return new ModelProviderError('ACCESS', name);
    case 'ThrottlingException':
    case 'ServiceQuotaExceededException':
      return new ModelProviderError('THROTTLED', name);
    case 'ServiceUnavailableException':
    case 'InternalServerException':
    case 'ModelTimeoutException':
    case 'ModelNotReadyException':
    case 'AbortError':
    case 'TimeoutError':
      return new ModelProviderError('UNAVAILABLE', name);
    case 'ValidationException':
      // Bedrock reports an account without model access as a validation error
      // ("Access to Bedrock models is not allowed for this account"): that is access, not a bad request.
      return new ModelProviderError(/access|not allowed|not authori[sz]ed|use case/i.test(error instanceof Error ? error.message : '') ? 'ACCESS' : 'INVALID_REQUEST', name);
    case 'ResourceNotFoundException':
      return new ModelProviderError('INVALID_REQUEST', name);
    default:
      // An expired or missing sign-in surfaces under several SDK error names
      // (credential providers, SSO and login token refresh): all are ACCESS.
      return new ModelProviderError(name && /credential|token|expired|sso|login/i.test(name) ? 'ACCESS' : 'UNKNOWN', name);
  }
}

export interface BedrockTransportOptions {
  readonly send: ConverseSender;
  /** Per attempt. */
  readonly timeoutMs?: number;
  /** All attempts and backoff together; no retry starts after it. */
  readonly deadlineMs?: number;
  readonly maxRetries?: number;
  /** Injected for tests; defaults to exponential backoff with full jitter. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => number;
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;

/**
 * Claude on Amazon Bedrock through the Converse API. The model ID is the
 * route's inference profile (e.g. `us.anthropic.claude-sonnet-5-5`).
 * Credentials come from the AWS SDK default chain (SSO profiles); no keys
 * are configured here. Nothing from the request or response is logged.
 * The route's effort is not sent: each model's documented default applies
 * until the Converse effort parameter is verified (ADR 0007).
 */
export class BedrockModelTransport implements ModelTransport {
  private readonly timeoutMs: number;
  private readonly deadlineMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(private readonly options: BedrockTransportOptions) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.deadlineMs = options.deadlineMs ?? 180_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const input: ConverseCommandInput = {
      modelId: request.modelId,
      system: request.system ? [{ text: request.system }] : undefined,
      // Images first, then the text (T-121): Converse image blocks carry the raw bytes.
      messages: request.messages.map((message) => ({
        role: message.role,
        content: [...(message.images ?? []).map((image) => ({ image: { format: image.format, source: { bytes: image.bytes } } })), { text: message.content }],
      })),
      inferenceConfig: { maxTokens: request.maxOutputTokens },
    };
    const deadline = this.now() + this.deadlineMs;
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(this.timeoutMs, deadline - this.now())));
      try {
        const output = await this.options.send(input, { abortSignal: controller.signal });
        // Adaptive thinking may add reasoning blocks; only text blocks are the answer.
        const text = (output.output?.message?.content ?? [])
          .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
          .join('');
        if (!text) throw new ModelProviderError('EMPTY_RESPONSE', null);
        return { text, inputTokens: output.usage?.inputTokens ?? 0, outputTokens: output.usage?.outputTokens ?? 0, modelId: request.modelId };
      } catch (error) {
        const failure = classify(error);
        if (!RETRYABLE.has(failure.kind) || attempt >= this.maxRetries) throw failure;
        // Full jitter: a random wait up to the capped exponential step, so callers retrying together spread out.
        const wait = Math.floor(this.random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt));
        if (this.now() + wait >= deadline) throw failure;
        await this.sleep(wait);
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

/**
 * The real sender: a Bedrock Runtime client in `region`, credentials from the
 * default chain (`AWS_PROFILE` with `aws sso login`). Imported lazily so code
 * paths that never call a model never load the SDK.
 */
export async function bedrockConverseSender(region: string): Promise<ConverseSender> {
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({ region });
  return (input, options) => client.send(new ConverseCommand(input), { abortSignal: options.abortSignal });
}
