export const ORGANIZATION_ROLES = ['ORG_OWNER', 'ORG_ADMIN', 'MEMBER'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const DEAL_ROLES = [
  'DEAL_LEAD',
  'ANALYST',
  'REVIEWER',
  'ADVISER',
  'TARGET_CONTRIBUTOR',
  'VIEWER',
] as const;
export type DealRole = (typeof DEAL_ROLES)[number];

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
};

const ORGANIZATION_ROLE_PERMISSIONS: Record<OrganizationRole, readonly Permission[]> = {
  ORG_OWNER: ['ORG_ADMIN', 'AUDIT_READ'],
  ORG_ADMIN: ['ORG_ADMIN', 'AUDIT_READ'],
  MEMBER: [],
};

export function permissionsForDealRole(role: DealRole): ReadonlySet<Permission> {
  return new Set(DEAL_ROLE_PERMISSIONS[role]);
}

export function permissionsForOrganizationRole(role: OrganizationRole): ReadonlySet<Permission> {
  return new Set(ORGANIZATION_ROLE_PERMISSIONS[role]);
}
