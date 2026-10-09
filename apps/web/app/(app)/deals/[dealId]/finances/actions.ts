'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { metricsApi } from '../../../metrics/_lib/api';

const target = z.strictObject({
  dealId: z.uuid(),
  asOf: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

function back(dealId: string, asOf: string, outcome: string): never {
  redirect(`/deals/${dealId}/finances?asOf=${asOf}&outcome=${outcome}`);
}

/** Record the reconciliation run; a difference is proposed as a draft finding. */
export async function recordReconciliation(dealId: string, asOf: string): Promise<void> {
  const parsed = target.safeParse({ dealId, asOf });
  if (!parsed.success) redirect('/deals');
  const result = await metricsApi.reconcile(parsed.data.dealId, parsed.data.asOf);
  back(parsed.data.dealId, parsed.data.asOf, result.kind === 'ok' ? 'recorded' : result.kind);
}

const approval = z.strictObject({
  reconciliationId: z.string().regex(/^[0-9a-f]{64}$/),
  note: z.string().trim().min(3).max(2000),
});

/** Reviewer approval of the difference. The API re-checks role and evidence currency. */
export async function approveDifference(
  dealId: string,
  asOf: string,
  formData: FormData,
): Promise<void> {
  const parsedTarget = target.safeParse({ dealId, asOf });
  if (!parsedTarget.success) redirect('/deals');
  const parsed = approval.safeParse({
    reconciliationId: formData.get('reconciliationId'),
    note: formData.get('note'),
  });
  if (!parsed.success) back(parsedTarget.data.dealId, parsedTarget.data.asOf, 'invalid');
  const result = await metricsApi.approve(
    parsedTarget.data.dealId,
    parsed.data.reconciliationId,
    parsedTarget.data.asOf,
    parsed.data.note,
  );
  back(
    parsedTarget.data.dealId,
    parsedTarget.data.asOf,
    result.kind === 'ok' ? 'approved' : result.kind,
  );
}
