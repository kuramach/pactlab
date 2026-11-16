'use server';

import { revalidatePath } from 'next/cache';
import { apiSend } from '../deals/_lib/api';

/** Organization admins turn API access on or off (T-128): off stops every API token at once. */
export async function setApiAccess(enabled: boolean): Promise<void> {
  await apiSend('PUT', '/v1/organization/api-access', { enabled });
  revalidatePath('/settings');
}

/** Organization admins remove a member's API sign-in (T-128): its tokens stop working at once. */
export async function revokeMemberGrant(grantId: string): Promise<void> {
  await apiSend('DELETE', `/v1/organization/api-access/grants/${encodeURIComponent(grantId)}`, {});
  revalidatePath('/settings');
}
