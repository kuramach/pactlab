export const ORGANIZATION_ROLES = ['ORG_OWNER', 'ORG_ADMIN', 'MEMBER'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/**
 * How a session holds its organization (T-094 B12, ADR 0014): as a member
 * (one of ORGANIZATION_ROLES), or as a GUEST — someone from another party on
 * one or more of the organization's pacts, with no organization membership.
 * GUEST is never stored as a membership role.
 */
export type TenantOrganizationRole = OrganizationRole | 'GUEST';

export const DEAL_ROLES = [
  'DEAL_LEAD',
  'ANALYST',
  'REVIEWER',
  'ADVISER',
  'TARGET_CONTRIBUTOR',
  'VIEWER',
  /** A bidding firm's person in a seller-led pact (T-097, ADR 0015). */
  'BIDDER',
  /** The buyer organization's investment committee on this pact (T-118, ADR 0029): reads, and decides the IC pack. */
  'INVESTMENT_COMMITTEE',
  /**
   * An investor seated in a pooled vehicle (T-141, ADR 0044): reads their own seat and the
   * organizer's published investor view, nothing else; never sees another investor.
   */
  'INVESTOR',
] as const;
export type DealRole = (typeof DEAL_ROLES)[number];

/**
 * The other party on a pact: the seller's contributor on a buyer-led pact,
 * a bidder on a seller-led one, or an investor seated in a vehicle (T-141).
 * Never the pact's own side, so never shown the owner's confidential analysis.
 */
export function isCounterpartyRole(role: DealRole): boolean {
  return role === 'TARGET_CONTRIBUTOR' || role === 'BIDDER' || role === 'INVESTOR';
}

export const PERMISSIONS = [
  'DEAL_READ',
  'DEAL_WRITE',
  'DEAL_MEMBERS_MANAGE',
  'EVIDENCE_READ',
  'BUYER_ANALYSIS_READ',
  'AUDIT_READ',
  'ORG_ADMIN',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const DEAL_ROLE_PERMISSIONS: Record<DealRole, readonly Permission[]> = {
  DEAL_LEAD: ['DEAL_READ', 'DEAL_WRITE', 'DEAL_MEMBERS_MANAGE', 'EVIDENCE_READ', 'BUYER_ANALYSIS_READ', 'AUDIT_READ'],
  ANALYST: ['DEAL_READ', 'DEAL_WRITE', 'EVIDENCE_READ', 'BUYER_ANALYSIS_READ'],
  REVIEWER: ['DEAL_READ', 'EVIDENCE_READ', 'BUYER_ANALYSIS_READ'],
  ADVISER: ['DEAL_READ', 'EVIDENCE_READ'],
  // Target contributors never receive buyer-only analysis by role.
  TARGET_CONTRIBUTOR: ['DEAL_READ'],
  VIEWER: ['DEAL_READ', 'BUYER_ANALYSIS_READ'],
  // A bidder reads the seller's shared view and their own bid; nothing else.
  BIDDER: ['DEAL_READ'],
  // The committee reads the buyer's analysis and decides; it changes nothing else (T-118).
  INVESTMENT_COMMITTEE: ['DEAL_READ', 'EVIDENCE_READ', 'BUYER_ANALYSIS_READ'],
  // An investor reads their own seat and the published investor view; no evidence (T-141).
  INVESTOR: ['DEAL_READ'],
};

const ORGANIZATION_ROLE_PERMISSIONS: Record<TenantOrganizationRole, readonly Permission[]> = {
  ORG_OWNER: ['ORG_ADMIN', 'AUDIT_READ'],
  ORG_ADMIN: ['ORG_ADMIN', 'AUDIT_READ'],
  MEMBER: [],
  // Guests act only through their deal roles.
  GUEST: [],
};

export function permissionsForDealRole(role: DealRole): ReadonlySet<Permission> {
  return new Set(DEAL_ROLE_PERMISSIONS[role]);
}

export function permissionsForOrganizationRole(role: TenantOrganizationRole): ReadonlySet<Permission> {
  return new Set(ORGANIZATION_ROLE_PERMISSIONS[role]);
}
