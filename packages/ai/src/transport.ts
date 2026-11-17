import type { ModelProvider, ReasoningEffort } from './models';

export interface ModelMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ModelRequest {
  readonly modelId: string;
  /** Where the model runs (T-131); Bedrock when absent. A routing transport picks the provider by it. */
  readonly provider?: ModelProvider | undefined;
  readonly effort: ReasoningEffort;
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly maxOutputTokens: number;
  /**
   * A second Claude model to try once after a transient failure (T-096). The
   * gateway sets it only for prompts whose evals passed on that model.
   */
  readonly fallbackModelId?: string | undefined;
}

export interface ModelResponse {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** The model that answered, when the transport knows it (it may be the fallback). */
  readonly modelId?: string;
}

/**
 * Provider boundary. The Bedrock transport implements this in deployed
 * environments; fixtures and CI replay recorded responses through the same
 * interface with outbound provider access blocked.
 */
export interface ModelTransport {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

const approxTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Replays scripted (cassette) responses. The responder sees the request and
 * the zero-based call number so tests can script repair attempts.
 */
export class ScriptedModelTransport implements ModelTransport {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly responder: (request: ModelRequest, call: number) => string) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const text = this.responder(request, this.requests.length);
    this.requests.push(request);
    const input = request.system + request.messages.map((message) => message.content).join('');
    return { text, inputTokens: approxTokens(input), outputTokens: approxTokens(text) };
  }
}
