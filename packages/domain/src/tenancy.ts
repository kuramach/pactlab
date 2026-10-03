import type { DealId, OrganizationId, UserId } from './ids';
import type { OrganizationRole } from './roles';

/**
 * Verified server-side tenant context. Built only from a verified identity
 * token plus database membership — never from client-supplied headers alone.
 * Every database transaction and background job establishes this first.
 */
export interface TenantContext {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly organizationRole: OrganizationRole;
  /** Deals the principal may access; RLS denies every other deal row. */
  readonly dealIds: readonly DealId[];
}

export class TenantAccessDeniedError extends Error {
  constructor(message = 'Access denied') {
    super(message);
    this.name = 'TenantAccessDeniedError';
  }
}
