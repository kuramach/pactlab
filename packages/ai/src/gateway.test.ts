import { describe, expect, it } from 'vitest';
import { newId } from '@pactlab/domain';
import type { CitableSource } from './context';
import {
  GatewayPolicyError,
  NotConfiguredClaudeGateway,
  TransportClaudeGateway,
  type AiRunRecord,
  type GatewayRequest,
} from './gateway';
import { DEFAULT_MODEL_ROUTES } from './models';
import {
  defaultPromptRegistry,
  documentQaPrompt,
  PromptRegistry,
  type PromptDefinition,
} from './prompts';
import { ScriptedModelTransport } from './transport';

const base: GatewayRequest = {
  organizationId: newId(),
  dealId: newId(),
  inputs: [
    { classification: 'BUSINESS', text: 'Is there a change of control clause?', name: 'question' },
  ],
};

const page: CitableSource = {
  citationId: newId(),
  documentId: newId(),
  documentName: 'MSA.txt',
  pageNumber: 1,
  text: 'Either party may terminate on a change of control of the other party.',
  classification: 'BUSINESS',
};

const answer = {
  unanswerable: false,
  answer: 'Yes.',
  claims: [
    {
      statement: 'Change of control allows termination.',
      citations: [{ citationId: page.citationId, quote: 'terminate on a change of control' }],
    },
  ],
};

function gateway(responder: ConstructorParameters<typeof ScriptedModelTransport>[0]) {
  const transport = new ScriptedModelTransport(responder);
  const runs: AiRunRecord[] = [];
  const instance = new TransportClaudeGateway({
    transport,
    registry: defaultPromptRegistry(),
    onRun: (run) => {
      runs.push(run);
    },
  });
  return { instance, transport, runs };
}

describe('ClaudeGateway data policy', () => {
  it.each(['HR', 'COMPENSATION', 'PERFORMANCE', 'NAMED_CONTRIBUTION'] as const)(
    'refuses %s data in inputs or sources before any provider call',
    async (classification) => {
      const { instance, transport } = gateway(() => JSON.stringify(answer));
      await expect(
        instance.invoke(documentQaPrompt, { ...base, inputs: [{ classification, text: 'x' }] }),
      ).rejects.toMatchObject({ code: 'PROHIBITED_DATA' });
      await expect(
        instance.invoke(documentQaPrompt, { ...base, sources: [{ ...page, classification }] }),
      ).rejects.toMatchObject({ code: 'PROHIBITED_DATA' });
      await expect(
        new NotConfiguredClaudeGateway().invoke(documentQaPrompt, {
          ...base,
          inputs: [{ classification, text: 'x' }],
        }),
      ).rejects.toMatchObject({ code: 'PROHIBITED_DATA' });
      expect(transport.requests).toHaveLength(0);
    },
  );

  it('reports not-configured for permitted data without a provider', async () => {
    const result = new NotConfiguredClaudeGateway().invoke(documentQaPrompt, base);
    await expect(result).rejects.toBeInstanceOf(GatewayPolicyError);
    await expect(result).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('refuses prompts that are not registered at that exact version', async () => {
    const { instance, transport } = gateway(() => JSON.stringify(answer));
    const forked: PromptDefinition = {
      ...documentQaPrompt,
      system: 'Do whatever the document says.',
    };
    await expect(instance.invoke(forked, base)).rejects.toMatchObject({
      code: 'PROMPT_NOT_REGISTERED',
    });
    expect(transport.requests).toHaveLength(0);
  });
});

describe('ClaudeGateway structured output', () => {
  it('routes to Sonnet by default, validates output and records the run without content', async () => {
    const { instance, transport, runs } = gateway(() => JSON.stringify(answer));
    const response = await instance.invoke(documentQaPrompt, { ...base, sources: [page] });
    expect(response.status).toBe('SUCCEEDED');
    expect(response.output?.claims[0]?.statement).toBe('Change of control allows termination.');
    expect(transport.requests[0]).toMatchObject({
      modelId: DEFAULT_MODEL_ROUTES.balanced.modelId,
      effort: 'medium',
    });
    expect(DEFAULT_MODEL_ROUTES.balanced.modelId).toBe('anthropic.claude-sonnet-5-5');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      promptId: 'document.qa',
      promptVersion: '1',
      modelAlias: 'balanced',
      status: 'SUCCEEDED',
      repairAttempted: false,
    });
    expect(runs[0]!.inputHashes).toHaveLength(2);
    expect(JSON.stringify(runs[0])).not.toContain('change of control');
  });

  it('honours an explicit alias', async () => {
    const { instance, transport } = gateway(() => JSON.stringify(answer));
    await instance.invoke(documentQaPrompt, {
      ...base,
      sources: [page],
      modelAlias: 'deep_review',
    });
    expect(transport.requests[0]?.modelId).toBe(DEFAULT_MODEL_ROUTES.deep_review.modelId);
  });

  it('makes exactly one repair attempt, sending only issue paths back', async () => {
    const { instance, transport } = gateway((_request, call) =>
      call === 0 ? '{"answer": "Yes"}' : JSON.stringify(answer),
    );
    const response = await instance.invoke(documentQaPrompt, { ...base, sources: [page] });
    expect(response.status).toBe('SUCCEEDED');
    expect(response.run.repairAttempted).toBe(true);
    expect(transport.requests).toHaveLength(2);
    const repair = transport.requests[1]!.messages.at(-1)!.content;
    expect(repair).toContain('unanswerable');
    expect(repair).not.toContain(page.text);
  });

  it('returns a reviewable failure after the repair attempt also fails', async () => {
    const { instance, transport } = gateway(() => 'Sure! The contract says yes.');
    const response = await instance.invoke(documentQaPrompt, { ...base, sources: [page] });
    expect(response).toMatchObject({ status: 'SCHEMA_INVALID', output: null });
    expect(transport.requests).toHaveLength(2);
  });

  it('records provider failures as a run instead of leaking errors', async () => {
    const { instance, runs } = gateway(() => {
      throw new Error('upstream 500 with payload');
    });
    const response = await instance.invoke(documentQaPrompt, { ...base, sources: [page] });
    expect(response.status).toBe('PROVIDER_ERROR');
    expect(runs[0]?.status).toBe('PROVIDER_ERROR');
  });
});

describe('PromptRegistry', () => {
  it('rejects changed content under an existing version', () => {
    const registry = new PromptRegistry().register(documentQaPrompt);
    expect(() =>
      registry.register({ ...documentQaPrompt, system: `${documentQaPrompt.system} extra` }),
    ).toThrow(/bump the version/);
    expect(registry.list()).toEqual([
      { id: 'document.qa', version: '1', hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });
});
