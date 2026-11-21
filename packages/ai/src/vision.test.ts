import { describe, expect, it } from 'vitest';
import { BedrockModelTransport, type ConverseSender } from './bedrock';
import { GatewayPolicyError, TransportClaudeGateway } from './gateway';
import { AnthropicModelTransport } from './http-providers';
import { defaultPromptRegistry } from './prompts';
import { visionPageText } from './prompts/document-vision';
import { ProviderRouterTransport } from './provider-router';
import { ScriptedModelTransport } from './transport';
import { readPageImage } from './vision';

const PNG = { format: 'png' as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };
const SCOPE = { organizationId: '01920000-0000-7000-8000-0000000000a1', dealId: '01920000-0000-7000-8000-0000000000d1' };
const reading = {
  kind: 'CHART',
  readable: true,
  text: 'Revenue bridge FY2025',
  tables: [{ title: 'ARR by quarter', rows: [['Q1', '$1.2M'], ['Q2', '$1.4M']] }],
  charts: [{ title: 'ARR', type: 'bar', xAxis: 'Quarter', yAxis: 'USD', series: [{ name: 'ARR', points: [{ x: 'Q1', y: '$1.2M' }, { x: 'Q2', y: '$1.4M' }] }] }],
  summary: 'ARR grew from $1.2M to $1.4M.',
};

describe('reading a page from its image (T-121)', () => {
  it('sends the image to Bedrock as a Converse image block before the text', async () => {
    const sent: unknown[] = [];
    const send: ConverseSender = async (input) => {
      sent.push(input);
      return { output: { message: { role: 'assistant', content: [{ text: JSON.stringify(reading) }] } }, usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020 }, stopReason: 'end_turn', metrics: { latencyMs: 10 } } as never;
    };
    const gateway = new TransportClaudeGateway({ transport: new BedrockModelTransport({ send, maxRetries: 0 }), registry: defaultPromptRegistry() });
    const result = await readPageImage(gateway, { ...SCOPE, label: 'Slide 7 of Board deck.pptx', images: [PNG], classification: 'FINANCIAL' });
    const content = (sent[0] as { messages: { content: unknown[] }[] }).messages[0]?.content;
    expect(content?.[0]).toEqual({ image: { format: 'png', source: { bytes: PNG.bytes } } });
    expect(content?.[1]).toMatchObject({ text: expect.stringContaining('Slide 7 of Board deck.pptx') });
    expect(result.run.jobType).toBe('vision');
    expect(result.text).toContain('ARR by quarter\nQ1 | $1.2M');
    expect(result.text).toContain('ARR: Q1 = $1.2M, Q2 = $1.4M');
  });

  it('a provider that cannot send images passes the page to the next lane', async () => {
    const claude = new ScriptedModelTransport(() => JSON.stringify(reading));
    const transport = new ProviderRouterTransport({ anthropic: new AnthropicModelTransport({ apiKey: async () => 'unused' }), bedrock: claude });
    const gateway = new TransportClaudeGateway({
      transport,
      registry: defaultPromptRegistry(),
      lanesFor: async () => [
        { modelId: 'claude-opus-5-5', provider: 'anthropic', effort: 'medium' },
        { modelId: 'us.anthropic.claude-sonnet-5-5', provider: 'bedrock', effort: 'medium' },
      ],
    });
    const result = await readPageImage(gateway, { ...SCOPE, label: 'Page 1', images: [PNG], classification: 'BUSINESS' });
    expect(result.reading?.kind).toBe('CHART');
    expect(result.run).toMatchObject({ fallbackFrom: 'claude-opus-5-5', fallbackReason: 'UNSUPPORTED' });
  });

  it('never sends a people-data page, nor an image without a classification', async () => {
    const transport = new ScriptedModelTransport(() => JSON.stringify(reading));
    const gateway = new TransportClaudeGateway({ transport, registry: defaultPromptRegistry() });
    await expect(readPageImage(gateway, { ...SCOPE, label: 'Page 1', images: [PNG], classification: 'COMPENSATION' })).rejects.toBeInstanceOf(GatewayPolicyError);
    await expect(
      gateway.invoke((await import('./prompts')).documentVisionPrompt, { ...SCOPE, inputs: [{ name: 'page', classification: 'BUSINESS', text: 'Page 1' }], images: [PNG] }),
    ).rejects.toBeInstanceOf(GatewayPolicyError);
    expect(transport.requests).toHaveLength(0);
  });

  it('stores an unreadable page as what could be read, never invented', () => {
    expect(visionPageText({ kind: 'SCANNED_TEXT', readable: false, text: '', tables: [], charts: [], summary: 'Too blurred to read.' })).toBe('Summary: Too blurred to read.');
  });
});
