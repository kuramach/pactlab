import { describe, expect, it } from 'vitest';
import { ModelProviderError } from './bedrock';
import { TransportClaudeGateway } from './gateway';
import { JOB_MODEL_MAP, JOB_TYPES, parseJobOverride } from './jobs';
import { MODEL_ALIASES } from './models';
import { defaultPromptRegistry, documentQaPrompt } from './prompts';
import type { ModelRequest } from './transport';

describe('the job-type registry (T-132)', () => {
  it('maps every registered prompt to a job type, and every job type to a chain that ends on a Claude lane', () => {
    for (const prompt of defaultPromptRegistry().list()) {
      const definition = defaultPromptRegistry().get(prompt.id, prompt.version);
      expect(JOB_TYPES, `${prompt.id}@${prompt.version}`).toContain(definition?.jobType);
    }
    for (const job of JOB_TYPES) {
      const { lanes } = JOB_MODEL_MAP[job];
      expect(lanes.length, job).toBeGreaterThan(0);
      // The degenerate case: a deployment with only its Claude provider still serves every job.
      expect(lanes.some((lane) => lane.kind === 'claude'), job).toBe(true);
      for (const lane of lanes) {
        if (lane.kind === 'claude') expect(MODEL_ALIASES).toContain(lane.alias);
        else expect(['bedrock', 'anthropic', 'openai', 'google']).toContain(lane.provider);
      }
    }
  });

  it('reads MODEL_JOB_<JOB> overrides as provider:model, and refuses anything else', () => {
    expect(parseJobOverride('anthropic:claude-opus-5-5')).toEqual({ provider: 'anthropic', modelId: 'claude-opus-5-5' });
    expect(parseJobOverride('openai:gpt-5.5')).toEqual({ provider: 'openai', modelId: 'gpt-5.5' });
    expect(parseJobOverride('fixture:x')).toBeNull();
    expect(parseJobOverride('gpt-5.5')).toBeNull();
    expect(parseJobOverride(undefined)).toBeNull();
  });
});

describe('walking a job’s lanes (T-132)', () => {
  const request = { organizationId: 'o', dealId: 'd', inputs: [{ text: 'q', classification: 'BUSINESS' as const }] };
  const lanes = [
    { modelId: 'gemini-x', provider: 'google' as const, effort: 'medium' as const },
    { modelId: 'claude-y', provider: 'anthropic' as const, effort: 'medium' as const },
  ];

  it('a lane that is down passes the job to the next; the run says which and why', async () => {
    const seen: ModelRequest[] = [];
    const gateway = new TransportClaudeGateway({
      registry: defaultPromptRegistry(),
      transport: {
        complete: async (call) => {
          seen.push(call);
          if (call.provider === 'google') throw new ModelProviderError('UNAVAILABLE', 'HTTP_503');
          return { text: '{"answer":"x","citations":[]}', inputTokens: 1, outputTokens: 1 };
        },
      },
      lanesFor: async ({ jobType }) => {
        expect(jobType).toBe('document_qa');
        return lanes;
      },
    });
    const response = await gateway.invoke(documentQaPrompt, request);
    // The answer misses the Q&A schema, so the one repair attempt runs, on the lane that answered.
    expect(seen.map((call) => call.provider)).toEqual(['google', 'anthropic', 'anthropic']);
    expect(response.run).toMatchObject({ jobType: 'document_qa', resolvedModelId: 'claude-y', resolvedProvider: 'anthropic', fallbackFrom: 'gemini-x', fallbackReason: 'UNAVAILABLE' });
  });

  it('never passes on for a request the model refused as invalid, and reports when every lane is down', async () => {
    const invalid = new TransportClaudeGateway({
      registry: defaultPromptRegistry(),
      transport: { complete: async () => Promise.reject(new ModelProviderError('INVALID_REQUEST', 'HTTP_400')) },
      lanesFor: async () => lanes,
    });
    expect((await invalid.invoke(documentQaPrompt, request)).run).toMatchObject({ status: 'PROVIDER_ERROR', resolvedModelId: 'gemini-x', fallbackFrom: null });
    const down = new TransportClaudeGateway({
      registry: defaultPromptRegistry(),
      transport: { complete: async () => Promise.reject(new ModelProviderError('THROTTLED', 'HTTP_429')) },
      lanesFor: async () => lanes,
    });
    const response = await down.invoke(documentQaPrompt, request);
    expect(response).toMatchObject({ status: 'PROVIDER_ERROR', providerError: 'THROTTLED' });
    expect(response.run).toMatchObject({ resolvedModelId: 'claude-y', fallbackFrom: 'gemini-x' });
    const blocked = new TransportClaudeGateway({ registry: defaultPromptRegistry(), transport: { complete: async () => ({ text: '{}', inputTokens: 0, outputTokens: 0 }) }, lanesFor: async () => 'BLOCKED' });
    await expect(blocked.invoke(documentQaPrompt, request)).rejects.toMatchObject({ code: 'NO_APPROVED_MODEL' });
  });
});
