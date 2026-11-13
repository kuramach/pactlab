'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

/** The investment committee (T-118). The API re-checks every role; these only shape the request. */
const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/ic?outcome=${outcome}`);
const outcomeOf = (result: { kind: string; code?: string }, ok: string) => (result.kind === 'ok' ? ok : result.code ? `error-${result.code}` : result.kind);
const ids = (...values: string[]) => {
  if (!values.every((value) => uuid.safeParse(value).success)) redirect('/deals');
};

export async function submitToIc(dealId: string): Promise<void> {
  ids(dealId);
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/ic/submissions`, {}), 'ok-submitted'));
}

const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'APPROVE_WITH_CONDITIONS', 'DECLINE']),
  note: z.string().trim().min(3).max(4000),
  conditions: z.string().max(20_000).transform((text) => text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)),
});

export async function decideIc(dealId: string, submissionId: string, formData: FormData): Promise<void> {
  ids(dealId, submissionId);
  const parsed = decisionSchema.safeParse({ decision: formData.get('decision'), note: formData.get('note'), conditions: formData.get('conditions') ?? '' });
  if (!parsed.success) return back(dealId, 'invalid-decision');
  const body = { ...parsed.data, conditions: parsed.data.decision === 'APPROVE_WITH_CONDITIONS' ? parsed.data.conditions : [] };
  if (body.decision === 'APPROVE_WITH_CONDITIONS' && body.conditions.length === 0) back(dealId, 'invalid-conditions');
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/ic/submissions/${submissionId}/decision`, body), 'ok-decided'));
}

export async function addressCondition(dealId: string, conditionId: string, formData: FormData): Promise<void> {
  ids(dealId, conditionId);
  const note = String(formData.get('note') ?? '').trim();
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/ic/conditions/${conditionId}/address`, { note: note || null }), 'ok-addressed'));
}

export async function clearCondition(dealId: string, conditionId: string): Promise<void> {
  ids(dealId, conditionId);
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/ic/conditions/${conditionId}/clear`, {}), 'ok-cleared'));
}

export async function setIcRequirement(dealId: string, formData: FormData): Promise<void> {
  ids(dealId);
  const value = String(formData.get('required') ?? 'org');
  const required = value === 'yes' ? true : value === 'no' ? false : null;
  back(dealId, outcomeOf(await apiSend('PUT', `/v1/deals/${dealId}/ic/requirement`, { required }), 'ok-requirement'));
}
