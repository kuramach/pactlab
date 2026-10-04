import { scanRequestSchema, type ScanResult } from '@pactlab/contracts';

/**
 * Scan intake for the shared contract. The contract does not yet carry the
 * resolved commit and approved tools, so a valid request still returns
 * NOT_IMPLEMENTED; execution goes through `runScan` with a full manifest.
 */
export function requestScan(input: unknown): ScanResult {
  const parsed = scanRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'REJECTED', reason: 'Scan request failed validation' };
  }
  return {
    status: 'NOT_IMPLEMENTED',
    scanId: parsed.data.scanId,
    reason: 'Scan runners are not available yet',
  };
}
