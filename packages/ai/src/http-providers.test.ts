import { describe, expect, it } from 'vitest';
import { ModelProviderError } from './bedrock';
import { GoogleModelTransport, kindOf, OpenAIModelTransport, type HttpFetch } from './http-providers';
import { ProviderRouterTransport } from './provider-router';
import type { ModelRequest } from './transport';

const REQUEST: ModelRequest = {
  modelId: 'model-x',
  provider: 'openai',
  effort: 'medium',
  system: 'Answer in JSON.',
  messages: [
    { role: 'user', content: 'Q' },
    { role: 'assistant', content: 'A' },
    { role: 'user', content: 'Fix it.' },
  ],
  maxOutputTokens: 2048,
};

function fake(status: number, body: unknown) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch: HttpFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    return { status, json: async () => body };
  };
  return { calls, fetch };
}

describe('OpenAI transport (Responses API)', () => {
  it('sends system as instructions, the turns as input, the effort and store:false; reads output_text parts and usage', async () => {
    const http = fake(200, {
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"a":' }, { type: 'output_text', text: '1}' }] },
      ],
      usage: { input_tokens: 120, output_tokens: 30 },
    });
    const transport = new OpenAIModelTransport({ apiKey: async () => 'sk-test', fetch: http.fetch });
    expect(await transport.complete(REQUEST)).toEqual({ text: '{"a":1}', inputTokens: 120, outputTokens: 30, modelId: 'model-x' });
    expect(http.calls[0]?.url).toBe('https://api.openai.com/v1/responses');
    expect(http.calls[0]?.headers['authorization']).toBe('Bearer sk-test');
    expect(http.calls[0]?.body).toEqual({
      model: 'model-x',
      instructions: 'Answer in JSON.',
      input: [
        { role: 'user', content: 'Q' },
        { role: 'assistant', content: 'A' },
        { role: 'user', content: 'Fix it.' },
      ],
      max_output_tokens: 2048,
      reasoning: { effort: 'medium' },
      store: false,
    });
  });

  it('maps failures to the gateway kinds: no text, a failed status, HTTP errors and network errors', async () => {
    await expect(new OpenAIModelTransport({ apiKey: async () => 'k', fetch: fake(200, { status: 'completed', output: [] }).fetch }).complete(REQUEST)).rejects.toMatchObject({ kind: 'EMPTY_RESPONSE' });
    await expect(new OpenAIModelTransport({ apiKey: async () => 'k', fetch: fake(200, { status: 'failed' }).fetch }).complete(REQUEST)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    await expect(new OpenAIModelTransport({ apiKey: async () => 'k', fetch: fake(429, {}).fetch }).complete(REQUEST)).rejects.toMatchObject({ kind: 'THROTTLED', providerCode: 'HTTP_429' });
    const broken: HttpFetch = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(new OpenAIModelTransport({ apiKey: async () => 'k', fetch: broken }).complete(REQUEST)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    expect([401, 403, 429, 500, 503, 400, 404].map(kindOf)).toEqual(['ACCESS', 'ACCESS', 'THROTTLED', 'UNAVAILABLE', 'UNAVAILABLE', 'INVALID_REQUEST', 'INVALID_REQUEST']);
  });
});

describe('Google transport (Gemini generateContent)', () => {
  it('sends the key in a header, the system instruction, user and model turns, JSON output and the thinking level; skips thought parts', async () => {
    const http = fake(200, {
      candidates: [{ content: { role: 'model', parts: [{ text: 'thinking…', thought: true }, { text: '{"a":1}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 40 },
    });
    const transport = new GoogleModelTransport({ apiKey: async () => 'g-key', fetch: http.fetch });
    expect(await transport.complete({ ...REQUEST, provider: 'google', modelId: 'gemini-x', effort: 'high' })).toEqual({ text: '{"a":1}', inputTokens: 100, outputTokens: 50, modelId: 'gemini-x' });
    expect(http.calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
    expect(http.calls[0]?.url).not.toContain('g-key');
    expect(http.calls[0]?.headers['x-goog-api-key']).toBe('g-key');
    expect(http.calls[0]?.body).toEqual({
      systemInstruction: { parts: [{ text: 'Answer in JSON.' }] },
      contents: [
        { role: 'user', parts: [{ text: 'Q' }] },
        { role: 'model', parts: [{ text: 'A' }] },
        { role: 'user', parts: [{ text: 'Fix it.' }] },
      ],
      generationConfig: { maxOutputTokens: 2048, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'HIGH' } },
    });
  });

  it('a blocked or empty candidate is an empty response, with the finish reason', async () => {
    const transport = new GoogleModelTransport({ apiKey: async () => 'k', fetch: fake(200, { candidates: [{ finishReason: 'SAFETY' }] }).fetch });
    await expect(transport.complete(REQUEST)).rejects.toMatchObject({ kind: 'EMPTY_RESPONSE', providerCode: 'SAFETY' });
  });
});

describe('provider router', () => {
  it('routes by provider (Bedrock by default) and refuses a provider with no connection', async () => {
    const seen: string[] = [];
    const named = (name: string) => ({ complete: async () => (seen.push(name), { text: '{}', inputTokens: 0, outputTokens: 0 }) });
    const router = new ProviderRouterTransport({ bedrock: named('bedrock'), openai: named('openai') });
    await router.complete({ ...REQUEST, provider: undefined });
    await router.complete(REQUEST);
    expect(seen).toEqual(['bedrock', 'openai']);
    expect(router.providers).toEqual(['bedrock', 'openai']);
    await expect(router.complete({ ...REQUEST, provider: 'google' })).rejects.toBeInstanceOf(ModelProviderError);
  });
});
