import type { OrganizationRole, Permission } from '@pactlab/domain';

export interface MeOrganizationView {
  id: string;
  name: string;
  slug: string;
  /** Auth0 organization reference, used to request an org-scoped Auth0 token; null for email-code organizations. */
  auth0OrganizationId: string | null;
  /** How members of this organization sign in. */
  authMethod: 'AUTH0' | 'EMAIL_CODE';
  role: OrganizationRole;
  permissions: Permission[];
}

export interface MeResponse {
  user: { id: string; displayName: string };
  organizations: MeOrganizationView[];
}
