import { scanResultSchema } from '@pactlab/contracts';
import { newId } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { requestScan } from './orchestrator';

const request = () => ({
  scanId: newId(),
  organizationId: newId(),
  dealId: newId(),
  repository: { connectionId: newId(), ref: 'main' },
  requestedBy: newId(),
  correlationId: 'corr',
});

describe('requestScan', () => {
  it('returns a typed NOT_IMPLEMENTED result for a valid request', () => {
    const input = request();
    const result = requestScan(input);
    expect(scanResultSchema.parse(result)).toEqual({
      status: 'NOT_IMPLEMENTED',
      scanId: input.scanId,
      reason: 'Scan runners are not available yet',
    });
  });

  it('rejects requests without tenant scope or with unknown fields', () => {
    const { organizationId: _omitted, ...unscoped } = request();
    expect(requestScan(unscoped).status).toBe('REJECTED');
    expect(requestScan({ ...request(), sourceArchiveUrl: 'https://x' }).status).toBe('REJECTED');
  });
});
