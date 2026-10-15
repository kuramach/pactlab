import type { ConverseCommandInput, ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import type { ModelRequest, ModelResponse, ModelTransport } from './transport';

/** Why a provider call failed, without any request or response content. */
export type ModelProviderErrorKind = 'ACCESS' | 'THROTTLED' | 'UNAVAILABLE' | 'INVALID_REQUEST' | 'EMPTY_RESPONSE' | 'UNKNOWN';

const HINTS: Record<ModelProviderErrorKind, string> = {
  ACCESS: 'Bedrock refused access: sign in (aws sso login) and enable the Claude models in the Bedrock console',
  THROTTLED: 'Bedrock is throttling requests; try again shortly',
  UNAVAILABLE: 'Bedrock is temporarily unavailable or timed out',
  INVALID_REQUEST: 'Bedrock rejected the request (model ID or parameters)',
  EMPTY_RESPONSE: 'Bedrock returned no text',
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

/** The one Bedrock Runtime call the transport makes; injected so tests never reach the network. */
export type ConverseSender = (input: ConverseCommandInput, options: { abortSignal: AbortSignal }) => Promise<ConverseCommandOutput>;

const RETRYABLE = new Set<ModelProviderErrorKind>(['THROTTLED', 'UNAVAILABLE']);

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
    case 'ResourceNotFoundException':
      return new ModelProviderError('INVALID_REQUEST', name);
    default:
      return new ModelProviderError('UNKNOWN', name);
  }
}

export interface BedrockTransportOptions {
  readonly send: ConverseSender;
  /** Per call, including retries. */
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** Injected for tests; defaults to jittered exponential backoff. */
  readonly sleep?: (ms: number) => Promise<void>;
}

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
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: BedrockTransportOptions) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const input: ConverseCommandInput = {
      modelId: request.modelId,
      system: request.system ? [{ text: request.system }] : undefined,
      messages: request.messages.map((message) => ({ role: message.role, content: [{ text: message.content }] })),
      inferenceConfig: { maxTokens: request.maxOutputTokens },
    };
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const output = await this.options.send(input, { abortSignal: controller.signal });
        // Adaptive thinking may add reasoning blocks; only text blocks are the answer.
        const text = (output.output?.message?.content ?? [])
          .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
          .join('');
        if (!text) throw new ModelProviderError('EMPTY_RESPONSE', null);
        return { text, inputTokens: output.usage?.inputTokens ?? 0, outputTokens: output.usage?.outputTokens ?? 0 };
      } catch (error) {
        const failure = classify(error);
        if (!RETRYABLE.has(failure.kind) || attempt >= this.maxRetries) throw failure;
        await this.sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250));
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
