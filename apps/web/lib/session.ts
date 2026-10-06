import type { OrganizationRole, Permission } from '@pactlab/domain';
import { cache } from 'react';
import { tokenOrganization } from './auth-flow';
import { auth0Session, identityAccessToken } from './auth0';
import { publicEnv } from './env';
import { nativeSessionToken } from './native-session';

/** Response of `GET /v1/me`. */
export interface MeOrganization {
  id: string;
  name: string;
  slug: string;
  /** Null for organizations that sign in with an emailed code. */
  auth0OrganizationId: string | null;
  authMethod: 'AUTH0' | 'EMAIL_CODE';
  role: OrganizationRole;
  permissions: Permission[];
}

export interface MeResponse {
  user: { id: string; displayName: string };
  organizations: MeOrganization[];
}

export type MeResult =
  { kind: 'ok'; data: MeResponse } | { kind: 'signed-out' } | { kind: 'error' };

/** The caller and their organizations, fetched server-side with the session token. */
export const getMe = cache(async (): Promise<MeResult> => {
  const token = await identityAccessToken();
  if (!token) return { kind: 'signed-out' };
  let response: Response;
  try {
    response = await fetch(new URL('/v1/me', publicEnv().NEXT_PUBLIC_API_ORIGIN), {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return { kind: 'error' };
  }
  if (response.ok) return { kind: 'ok', data: (await response.json()) as MeResponse };
  if (response.status === 401) return { kind: 'signed-out' };
  return { kind: 'error' };
});

export type SessionContext =
  | { kind: 'signed-out'; permissions: ReadonlySet<Permission> }
  | {
      kind: 'signed-in';
      displayName: string;
      /** The organization the session's token is scoped to; null if not (yet) resolvable. */
      organization: MeOrganization | null;
      permissions: ReadonlySet<Permission>;
    };

/**
 * Signed-in user and active organization for the shell. The active
 * organization is the one the session's token is scoped to (Auth0 `org_id`
 * or email-code `pactlab_org`), matched against the caller's memberships
 * from the API — never a client value.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const session = await auth0Session();
  const nativeToken = session ? null : await nativeSessionToken();
  if (!session && !nativeToken) return { kind: 'signed-out', permissions: new Set() };
  const me = await getMe();
  const nativeOrganization = nativeToken ? tokenOrganization(nativeToken) : null;
  const organization =
    me.kind !== 'ok'
      ? null
      : session
        ? (session.user.org_id
            ? me.data.organizations.find((org) => org.auth0OrganizationId === session.user.org_id)
            : undefined) ?? null
        : (me.data.organizations.find((org) => org.id === nativeOrganization) ?? null);
  return {
    kind: 'signed-in',
    displayName:
      me.kind === 'ok'
        ? me.data.user.displayName
        : (session?.user.name ?? session?.user.email ?? 'Signed in'),
    organization,
    permissions: new Set(organization?.permissions ?? []),
  };
});

/**
 * Server-side session permissions from `GET /v1/me` for the active
 * organization. Drives UI visibility only; the API enforces authorization.
 */
export async function getSessionPermissions(): Promise<ReadonlySet<Permission>> {
  return (await getSessionContext()).permissions;
}
