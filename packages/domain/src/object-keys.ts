import { isUuid } from './ids';

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/**
 * Object-store keys are always prefixed by tenant and deal so bucket policies,
 * KMS encryption context and database constraints can all enforce isolation.
 */
export function tenantObjectKey(organizationId: string, dealId: string, ...segments: string[]): string {
  if (!isUuid(organizationId) || !isUuid(dealId)) {
    throw new Error('Object keys require UUID organization and deal identifiers');
  }
  if (segments.length === 0) {
    throw new Error('Object keys require at least one path segment');
  }
  for (const segment of segments) {
    if (!SAFE_SEGMENT.test(segment) || segment.includes('..')) {
      throw new Error('Unsafe object key segment');
    }
  }
  return [organizationId, dealId, ...segments].join('/');
}

export function objectKeyBelongsTo(key: string, organizationId: string, dealId: string): boolean {
  return key.startsWith(`${organizationId}/${dealId}/`);
}
