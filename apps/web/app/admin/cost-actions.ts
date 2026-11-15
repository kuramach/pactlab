'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost, apiSend } from '../(app)/deals/_lib/api';

// The filters go back as they came; anything else is dropped.
const back = (outcome: string, query = ''): never => redirect(`/admin?tab=cost${/^(&[a-z]+=[a-z0-9-]{1,100})*$/.test(query) ? query : ''}&outcome=${outcome}`);

/** Read Cost Explorer again now (at most hourly: each request costs about a cent). */
export async function refreshHostingCost(query: string): Promise<void> {
  const result = await apiPost('/v1/admin/cost/refresh', {});
  revalidatePath('/admin');
  back(result.kind === 'ok' ? 'ok-cost-refreshed' : result.kind === 'conflict' ? 'cost-refreshed-recently' : result.kind, query);
}

const rateSchema = z.strictObject({
  kind: z.enum(['BEDROCK_INPUT_PER_MTOK', 'BEDROCK_OUTPUT_PER_MTOK', 'S3_STORAGE_GB_MONTH']),
  key: z.string().trim().min(1).max(200),
  unitPrice: z.string().trim().regex(/^\d{1,10}(\.\d{1,8})?$/),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceNote: z.string().trim().max(500),
});

/** A unit price from AWS's price page, from a date (the same date corrects it). */
export async function setCostRate(formData: FormData): Promise<void> {
  const parsed = rateSchema.safeParse({
    kind: formData.get('kind'),
    key: formData.get('kind') === 'S3_STORAGE_GB_MONTH' ? 'standard' : formData.get('key'),
    unitPrice: formData.get('unitPrice'),
    effectiveFrom: formData.get('effectiveFrom'),
    sourceNote: formData.get('sourceNote') ?? '',
  });
  if (!parsed.success) return back('cost-rate-invalid');
  const result = await apiPost('/v1/admin/cost/rates', { ...parsed.data, currency: 'USD' });
  revalidatePath('/admin');
  back(result.kind === 'ok' ? 'ok-cost-rate' : result.kind);
}

export async function deleteCostRate(rateId: string): Promise<void> {
  if (!z.uuid().safeParse(rateId).success) return back('invalid');
  const result = await apiSend('DELETE', `/v1/admin/cost/rates/${rateId}`, {});
  revalidatePath('/admin');
  back(result.kind === 'ok' ? 'ok-cost-rate-deleted' : result.kind);
}
