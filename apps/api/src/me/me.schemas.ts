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

/** A pact the user is a guest on (T-094 B12): another organization's pact, joined by invitation. */
export interface MeGuestPactView {
  organizationId: string;
  organizationName: string;
  dealId: string;
  dealName: string;
  role: string;
}

export interface MeResponse {
  user: { id: string; displayName: string };
  organizations: MeOrganizationView[];
  /** Pacts in other organizations this user joined as a guest; switch to one to open it. */
  guestPacts: MeGuestPactView[];
}
