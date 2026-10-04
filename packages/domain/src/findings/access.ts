import { permissionsForDealRole, type DealRole } from '../roles';

/**
 * Findings are buyer-side analysis. Target contributors never see them by
 * role; sharing a finding across the boundary is not supported yet.
 */
export function canReadFindings(role: DealRole): boolean {
  return permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
}

/** Drafting and editing drafts. */
export function canDraftFindings(role: DealRole): boolean {
  return permissionsForDealRole(role).has('DEAL_WRITE');
}

/** Accepting, rejecting or returning a finding for support. */
export function canReviewFindings(role: DealRole): boolean {
  return role === 'DEAL_LEAD' || role === 'REVIEWER';
}
