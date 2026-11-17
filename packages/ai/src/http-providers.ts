import { ModelProviderError, type ModelProviderErrorKind } from './bedrock';
import type { ReasoningEffort } from './models';
import type { ModelRequest, ModelResponse, ModelTransport } from './transport';

/**
 * OpenAI and Google model transports (T-131, ADR 0029): the same `ModelTransport` as Bedrock, over
 * each provider's REST API, so the gateway, schema validation, citations, retries and the circuit
 * breaker work unchanged. Request and response shapes follow the providers' published references:
 * OpenAI's Responses API (`POST /v1/responses`, as typed by the official `openai` SDK) and Google's
 * Gemini API (`POST /v1beta/models/{model}:generateContent`). Keys come from Secrets Manager; they
 * are sent in a header and never logged. Prompts and outputs are never logged either.
 */
export type HttpFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

interface HttpOptions {
  /** The provider key, read on use (a rotated key applies without a restart of this object). */
  readonly apiKey: () => Promise<string>;
  readonly fetch?: HttpFetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

/** HTTP status → the gateway's error kinds (retries and the breaker act on THROTTLED and UNAVAILABLE). */
export function kindOf(status: number): ModelProviderErrorKind {
  if (status === 401 || status === 403) return 'ACCESS';
  if (status === 429) return 'THROTTLED';
  if (status >= 500) return 'UNAVAILABLE';
  if (status >= 400) return 'INVALID_REQUEST';
  return 'UNKNOWN';
}

async function post(options: HttpOptions, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const http = options.fetch ?? (globalThis.fetch as unknown as HttpFetch);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await http(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
    if (response.status < 200 || response.status >= 300) throw new ModelProviderError(kindOf(response.status), `HTTP_${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof ModelProviderError) throw error;
    // Network failure or timeout: transient.
    throw new ModelProviderError('UNAVAILABLE', error instanceof Error ? error.name : null);
  } finally {
    clearTimeout(timer);
  }
}

/** OpenAI Responses API. `store: false`: OpenAI keeps no response object for later retrieval. */
export class OpenAIModelTransport implements ModelTransport {
  constructor(private readonly options: HttpOptions) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const key = await this.options.apiKey();
    const body = await post(this.options, `${this.options.baseUrl ?? 'https://api.openai.com/v1'}/responses`, { authorization: `Bearer ${key}` }, {
      model: request.modelId,
      instructions: request.system,
      input: request.messages.map((message) => ({ role: message.role, content: message.content })),
      max_output_tokens: request.maxOutputTokens,
      reasoning: { effort: request.effort },
      store: false,
    });
    const response = body as {
      status?: string;
      output?: { type?: string; content?: { type?: string; text?: string }[] }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (response.status === 'failed' || response.status === 'cancelled') throw new ModelProviderError('UNAVAILABLE', `STATUS_${response.status}`);
    // The text is the concatenated output_text parts of the message items (`output_text` itself is an SDK convenience).
    const text = (response.output ?? [])
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    if (!text) throw new ModelProviderError('EMPTY_RESPONSE', response.status ? `STATUS_${response.status}` : null);
    return { text, inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0, modelId: request.modelId };
  }
}

const THINKING: Record<ReasoningEffort, 'LOW' | 'MEDIUM' | 'HIGH'> = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };

/** Google Gemini API (`generateContent`). The key goes in `x-goog-api-key`, never in the URL. */
export class GoogleModelTransport implements ModelTransport {
  constructor(private readonly options: HttpOptions) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const key = await this.options.apiKey();
    const model = encodeURIComponent(request.modelId);
    const body = await post(this.options, `${this.options.baseUrl ?? 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent`, { 'x-goog-api-key': key }, {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
      generationConfig: { maxOutputTokens: request.maxOutputTokens, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: THINKING[request.effort] } },
    });
    const response = body as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    const candidate = response.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((part) => typeof part.text === 'string' && part.thought !== true)
      .map((part) => part.text)
      .join('');
    if (!text) throw new ModelProviderError('EMPTY_RESPONSE', candidate?.finishReason ?? null);
    const usage = response.usageMetadata;
    return { text, inputTokens: usage?.promptTokenCount ?? 0, outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0), modelId: request.modelId };
  }
}
