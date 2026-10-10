'use server';

import { DEAL_ROLES } from '@pactlab/domain';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { dealsApi } from '../../_lib/api';

const input = z.strictObject({ dealId: z.uuid(), userId: z.uuid(), role: z.enum(DEAL_ROLES) });

/** Add or change a member's role. Only deal leads may; the API decides. */
export async function addMember(dealId: string, formData: FormData): Promise<void> {
  const parsed = input.safeParse({ dealId, userId: formData.get('userId'), role: formData.get('role') });
  if (!parsed.success) redirect(`/deals/${dealId}/team?outcome=invalid`);
  const result = await dealsApi.addMember(parsed.data.dealId, parsed.data.userId, parsed.data.role);
  redirect(`/deals/${dealId}/team?outcome=${result.kind === 'ok' ? 'ok-added' : result.kind}`);
}
