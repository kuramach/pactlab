'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { organizationLoginPath, safeReturnTo, SELECT_ORGANIZATION_PATH } from '../../lib/auth-flow';
import { authApi, nativeSessionToken, storeNativeSession, type IssuedSession } from '../../lib/native-session';
import { getMe } from '../../lib/session';

const choice = z.strictObject({
  organizationId: z.uuid(),
  returnTo: z.string().max(2000),
});

/**
 * Enter the chosen organization. The choice is checked against the caller's
 * memberships from the API, never trusted from the form. Auth0 sessions
 * re-authorize so the token carries `org_id`; email-code sessions ask the
 * API to rescope the server-side session, which re-checks membership.
 */
export async function chooseOrganization(formData: FormData): Promise<void> {
  const parsed = choice.safeParse({
    organizationId: formData.get('organizationId'),
    returnTo: formData.get('returnTo'),
  });
  if (!parsed.success) redirect(SELECT_ORGANIZATION_PATH);
  const me = await getMe();
  if (me.kind !== 'ok') redirect(SELECT_ORGANIZATION_PATH);
  const organization = me.data.organizations.find((org) => org.id === parsed.data.organizationId);
  if (!organization) redirect(SELECT_ORGANIZATION_PATH);
  const returnTo = safeReturnTo(parsed.data.returnTo);

  if (organization.authMethod === 'AUTH0' && organization.auth0OrganizationId) {
    redirect(organizationLoginPath(organization.auth0OrganizationId, returnTo));
  }
  const token = await nativeSessionToken();
  if (!token) redirect(SELECT_ORGANIZATION_PATH);
  const scoped = await authApi('/v1/auth/session/organization', { organizationId: organization.id }, token);
  if (scoped.status !== 200) redirect(SELECT_ORGANIZATION_PATH);
  await storeNativeSession(scoped.data as IssuedSession);
  redirect(returnTo);
}
