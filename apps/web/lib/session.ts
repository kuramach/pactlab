import type { OrganizationRole, Permission } from '@pactlab/domain';
import { cache } from 'react';
import { auth0, identityAccessToken } from './auth0';
import { publicEnv } from './env';

/** Response of `GET /v1/me`. */
export interface MeOrganization {
  id: string;
  name: string;
  slug: string;
  auth0OrganizationId: string;
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
 * organization is the `org_id` the session was authorized into, matched
 * against the caller's memberships from the API — never a client value.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const session = await auth0().getSession();
  if (!session) return { kind: 'signed-out', permissions: new Set() };
  const me = await getMe();
  const organization =
    me.kind === 'ok' && session.user.org_id
      ? (me.data.organizations.find((org) => org.auth0OrganizationId === session.user.org_id) ??
        null)
      : null;
  return {
    kind: 'signed-in',
    displayName:
      me.kind === 'ok'
        ? me.data.user.displayName
        : (session.user.name ?? session.user.email ?? 'Signed in'),
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
