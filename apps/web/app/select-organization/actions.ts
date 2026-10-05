'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { organizationLoginPath, safeReturnTo, SELECT_ORGANIZATION_PATH } from '../../lib/auth-flow';
import { getMe } from '../../lib/session';

const choice = z.strictObject({
  organizationId: z.uuid(),
  returnTo: z.string().max(2000),
});

/**
 * Re-authorize into the chosen organization. The choice is checked against
 * the caller's memberships from the API, never trusted from the form; it is
 * persisted as the `org_id` claim of the new encrypted session.
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
  redirect(
    organizationLoginPath(organization.auth0OrganizationId, safeReturnTo(parsed.data.returnTo)),
  );
}
