import { describe, expect, it } from 'vitest';
import { newId } from '@pactlab/domain';
import { GatewayPolicyError, NotConfiguredClaudeGateway, type GatewayRequest } from './gateway';

const base: Omit<GatewayRequest, 'inputs'> = {
  organizationId: newId(),
  dealId: newId(),
  taskType: 'document.summarize',
  promptId: 'summarize',
  promptVersion: '1',
  modelAlias: 'fast',
};

describe('ClaudeGateway stub', () => {
  const gateway = new NotConfiguredClaudeGateway();

  it.each(['HR', 'COMPENSATION', 'PERFORMANCE', 'NAMED_CONTRIBUTION'] as const)(
    'refuses %s data before any provider call',
    async (classification) => {
      await expect(gateway.invoke({ ...base, inputs: [{ classification, text: 'x' }] })).rejects.toMatchObject({
        code: 'PROHIBITED_DATA',
      });
    },
  );

  it('reports not-configured for permitted data', async () => {
    const result = gateway.invoke({ ...base, inputs: [{ classification: 'BUSINESS', text: 'x' }] });
    await expect(result).rejects.toBeInstanceOf(GatewayPolicyError);
    await expect(result).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});
