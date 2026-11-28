'use server';

import { approveFeatureRequestSchema, decideFeatureRequestSchema, linkFeatureRequestSchema } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../(app)/deals/_lib/api';

const uuid = z.uuid();
const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();
const nullable = (formData: FormData, name: string) => text(formData, name) || null;
const here = (id: string, outcome: string): never => redirect(`/admin/feature-requests/${id}?outcome=${outcome}`);
const words = (value: string) => value.split(/[\s,]+/).filter(Boolean);

/** Take it up, decline (with an optional reason), ask the requester a question, or reopen with their reply. */
export async function decideFeatureRequest(id: string, formData: FormData): Promise<void> {
  const action = text(formData, 'action');
  const parsed = decideFeatureRequestSchema.safeParse(
    action === 'DECLINE' ? { action, reason: formData.get('reason') ?? '' } : action === 'REQUEST_INFO' ? { action, question: text(formData, 'question') } : action === 'REOPEN' ? { action, reply: formData.get('reply') ?? '' } : { action },
  );
  if (!parsed.success || !uuid.safeParse(id).success) return here(id, 'invalid');
  const result = await apiSend('POST', `/v1/admin/feature-requests/${id}/decision`, parsed.data);
  here(id, result.kind === 'ok' ? `ok-${action.toLowerCase()}` : result.kind);
}

/** Approve with the tier and touches Kumar confirmed; nothing is filed until he labels the issue it opens. */
export async function approveFeatureRequest(id: string, formData: FormData): Promise<void> {
  const parsed = approveFeatureRequestSchema.safeParse({
    model: text(formData, 'model'),
    lane: text(formData, 'lane'),
    context: text(formData, 'context'),
    touches: words(text(formData, 'touches')),
    needs: text(formData, 'needs') || 'none',
    title: text(formData, 'title'),
  });
  if (!parsed.success || !uuid.safeParse(id).success) return here(id, 'invalid');
  const result = await apiSend('POST', `/v1/admin/feature-requests/${id}/approve`, parsed.data);
  here(id, result.kind === 'ok' ? 'ok-approve' : result.kind);
}

/** Record the task the workflow filed, its pull request, and the What's-new card once it is built. */
export async function linkFeatureRequest(id: string, formData: FormData): Promise<void> {
  const parsed = linkFeatureRequestSchema.safeParse({ taskId: nullable(formData, 'taskId'), pullRequestUrl: nullable(formData, 'pullRequestUrl'), whatsNewUrl: nullable(formData, 'whatsNewUrl') });
  if (!parsed.success || !uuid.safeParse(id).success) return here(id, 'invalid');
  const result = await apiSend('PUT', `/v1/admin/feature-requests/${id}/links`, parsed.data);
  here(id, result.kind === 'ok' ? 'ok-link' : result.kind);
}

/** Confirm a suggested requester as the same ask, or split them out. */
export async function groupFeatureSupporter(id: string, supporterId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(id).success || !uuid.safeParse(supporterId).success) return here(id, 'invalid');
  const result = await apiSend('POST', `/v1/admin/feature-requests/${id}/supporters/${supporterId}/group`, { confirm: text(formData, 'confirm') === 'yes' });
  here(id, result.kind === 'ok' ? 'ok-group' : result.kind);
}
