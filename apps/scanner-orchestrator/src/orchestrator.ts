import { scanRequestSchema, type ScanResult } from '@pactlab/contracts';

/**
 * Scan intake. Real runners (one ephemeral, isolated task per scan; workspace
 * destroyed on every exit path; findings only, never source) arrive in T-004.
 * Until then a valid request returns a typed NOT_IMPLEMENTED result and
 * nothing is cloned, executed or persisted.
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
