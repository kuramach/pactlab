import type { DealId, OrganizationId, UserId } from './ids';
import type { TenantOrganizationRole } from './roles';

/**
 * Verified server-side tenant context. Built only from a verified identity
 * token plus database membership — never from client-supplied headers alone.
 * Every database transaction and background job establishes this first.
 */
export interface TenantContext {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  /** GUEST: on some of this organization's pacts, not a member of it (ADR 0014). */
  readonly organizationRole: TenantOrganizationRole;
  /** Deals the principal may access; RLS denies every other deal row. */
  readonly dealIds: readonly DealId[];
}

export class TenantAccessDeniedError extends Error {
  constructor(message = 'Access denied') {
    super(message);
    this.name = 'TenantAccessDeniedError';
  }
}
