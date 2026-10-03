import { describe, expect, it } from 'vitest';
import { newId } from '@pactlab/domain';
import { jobEnvelopeSchema, listDealsQuerySchema, transactionTypeSchema } from './index';

describe('contracts', () => {
  it('accepts exactly the three transaction types', () => {
    expect(transactionTypeSchema.options).toEqual(['PUBLIC_ACQUIRER', 'PRIVATE_ACQUIRER', 'TAKE_PRIVATE']);
    expect(transactionTypeSchema.safeParse('MERGER').success).toBe(false);
  });

  it('requires the full job contract and rejects unknown fields', () => {
    const envelope = {
      jobId: newId(),
      organizationId: newId(),
      dealId: newId(),
      type: 'system.noop',
      schemaVersion: 1,
      idempotencyKey: 'noop:1',
      attempt: 0,
      requestedBy: newId(),
      correlationId: 'corr-1',
    };
    expect(jobEnvelopeSchema.parse(envelope).payload).toEqual({});
    expect(jobEnvelopeSchema.safeParse({ ...envelope, organizationId: undefined }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({ ...envelope, extra: true }).success).toBe(false);
  });

  it('rejects unknown query parameters', () => {
    expect(listDealsQuerySchema.safeParse({ q: 'acme', organizationId: newId() }).success).toBe(false);
  });
});
