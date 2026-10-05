import type { OrganizationRole, Permission } from '@pactlab/domain';

export interface MeOrganizationView {
  id: string;
  name: string;
  slug: string;
  /** Identity-provider organization reference, used to request an org-scoped token. */
  auth0OrganizationId: string;
  role: OrganizationRole;
  permissions: Permission[];
}

export interface MeResponse {
  user: { id: string; displayName: string };
  organizations: MeOrganizationView[];
}
