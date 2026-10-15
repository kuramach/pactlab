import type { ConverseCommandInput, ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it } from 'vitest';
import { BedrockModelTransport, ModelProviderError, modelLabel, type ConverseSender } from '.';

const REQUEST = {
  modelId: 'us.anthropic.claude-sonnet-5-5',
  effort: 'medium' as const,
  system: 'You extract contract terms.',
  messages: [{ role: 'user' as const, content: 'Synthetic contract text' }],
  maxOutputTokens: 2000,
};

const reply = (content: unknown[], usage = { inputTokens: 120, outputTokens: 40, totalTokens: 160 }) =>
  ({ output: { message: { role: 'assistant', content } }, usage, stopReason: 'end_turn', metrics: { latencyMs: 1 }, $metadata: {} }) as unknown as ConverseCommandOutput;

const failure = (name: string) => Object.assign(new Error('provider message with details'), { name });

describe('BedrockModelTransport', () => {
  it('maps the request to Converse and returns only the text blocks with usage', async () => {
    const sent: ConverseCommandInput[] = [];
    const send: ConverseSender = async (input) => {
      sent.push(input);
      return reply([{ reasoningContent: { reasoningText: { text: 'thinking' } } }, { text: '{"a":' }, { text: '1}' }]);
    };
    const response = await new BedrockModelTransport({ send }).complete(REQUEST);
    expect(response).toEqual({ text: '{"a":1}', inputTokens: 120, outputTokens: 40 });
    expect(sent[0]).toEqual({
      modelId: 'us.anthropic.claude-sonnet-5-5',
      system: [{ text: 'You extract contract terms.' }],
      messages: [{ role: 'user', content: [{ text: 'Synthetic contract text' }] }],
      inferenceConfig: { maxTokens: 2000 },
    });
  });

  it('retries throttling with backoff, then gives up', async () => {
    let calls = 0;
    const waits: number[] = [];
    const send: ConverseSender = async () => {
      calls += 1;
      if (calls < 3) throw failure('ThrottlingException');
      return reply([{ text: 'ok' }]);
    };
    const transport = new BedrockModelTransport({ send, sleep: async (ms) => void waits.push(ms) });
    expect((await transport.complete(REQUEST)).text).toBe('ok');
    expect(waits).toHaveLength(2);

    const always: ConverseSender = async () => {
      throw failure('ServiceUnavailableException');
    };
    await expect(new BedrockModelTransport({ send: always, sleep: async () => {} }).complete(REQUEST)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
      providerCode: 'ServiceUnavailableException',
    });
  });

  it('does not retry access or validation errors, and never carries the provider message', async () => {
    let calls = 0;
    const send: ConverseSender = async () => {
      calls += 1;
      throw failure('AccessDeniedException');
    };
    const error = await new BedrockModelTransport({ send, sleep: async () => {} }).complete(REQUEST).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error).toMatchObject({ kind: 'ACCESS', providerCode: 'AccessDeniedException' });
    expect((error as Error).message).not.toContain('details');
    expect(calls).toBe(1);
    const invalid: ConverseSender = async () => {
      throw failure('ValidationException');
    };
    await expect(new BedrockModelTransport({ send: invalid }).complete(REQUEST)).rejects.toMatchObject({ kind: 'INVALID_REQUEST' });
  });

  it('treats an answer with no text as a failure', async () => {
    const send: ConverseSender = async () => reply([{ reasoningContent: { reasoningText: { text: 'only thinking' } } }]);
    await expect(new BedrockModelTransport({ send }).complete(REQUEST)).rejects.toMatchObject({ kind: 'EMPTY_RESPONSE' });
  });

  it('aborts a call that runs past the timeout', async () => {
    const send: ConverseSender = (_input, { abortSignal }) =>
      new Promise((_resolve, reject) => abortSignal.addEventListener('abort', () => reject(failure('AbortError'))));
    await expect(new BedrockModelTransport({ send, timeoutMs: 5, maxRetries: 0 }).complete(REQUEST)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });
});

describe('modelLabel', () => {
  it('names models from IDs and inference profiles', () => {
    expect(modelLabel('us.anthropic.claude-sonnet-5-5')).toBe('Claude Sonnet 5.5');
    expect(modelLabel('eu.anthropic.claude-haiku-5-5')).toBe('Claude Haiku 5.5');
    expect(modelLabel('something-else')).toBe('something-else');
  });
});
